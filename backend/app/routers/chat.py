"""对话接口：SSE 流式对话 + 历史消息。"""

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.config import get_settings
from app.db import DbSession
from app.deps import UserId
from app.models import ChatConversation
from app.registry import get_app
from app.schemas import ChatMessageRequest
from app.tcadp import ConversationCallback, UpstreamError

router = APIRouter(prefix='/chat', tags=['chat'])

# 禁止中间层（nginx / 网关）缓冲，否则心跳会被攒着一起发，失去保活作用
SSE_HEADERS = {
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'Connection': 'keep-alive',
}


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def _derive_title(contents: list[dict]) -> str:
    """会话标题：用户真实输入的文字前 20 字。

    只认 text 类型的 content；questionnaire（澄清回执）等协议占位不算，
    file 仅在没有任何文本时兜底取文件名。纯符号文本跳过。
    """
    fallback = ''
    for c in contents:
        ctype = c.get('Type')
        if ctype == 'text':
            text = (c.get('Text') or '').strip()
            if text and any(ch.isalnum() or '\u4e00' <= ch <= '\u9fff' for ch in text):
                return text[:20]
        elif ctype == 'file' and not fallback:
            fallback = ((c.get('File') or {}).get('FileName') or '').strip()[:20]
    return fallback


class ConversationStore(ConversationCallback):
    """会话落库：chat() 在流开始/结束时回调。"""

    def __init__(self, db, application_id: str, user_id: str, title: str = ''):
        self.db = db
        self.application_id = application_id
        self.user_id = user_id
        self.title = title

    async def create(self, title: str = '') -> dict:
        now = _now_ms()
        conversation = ChatConversation(
            id=uuid.uuid4().hex,
            user_id=self.user_id,
            application_id=self.application_id,
            title=self.title or title or '新对话',
            last_active_at=now,
            created_at=now,
        )
        self.db.add(conversation)
        await self.db.commit()
        return conversation.to_dict()

    async def update(self, conversation_id: str) -> dict | None:
        conversation = await self.db.get(ChatConversation, conversation_id)
        if conversation is None:
            return None
        conversation.last_active_at = _now_ms()
        # 存量会话标题还是默认值时，用本次上行的用户输入回填一次
        if self.title and (not conversation.title or conversation.title == '新对话'):
            conversation.title = self.title
        await self.db.commit()
        return conversation.to_dict()


@router.post('/message')
async def chat_message(body: ChatMessageRequest, user_id: UserId, db: DbSession):
    """SSE 对话。上游 V2 事件原样透传，空闲期间插入心跳帧。"""
    app = get_app(body.ApplicationId)

    contents = list(body.Contents)
    if body.CustomVariables:
        contents.append({'Type': 'custom_variables', 'CustomVariables': body.CustomVariables})

    store = ConversationStore(db, app.application_id, user_id, title=_derive_title(contents))
    generator = app.chat(
        user_id=user_id,
        contents=contents,
        conversation_id=body.ConversationId,
        is_new_conversation=not body.ConversationId,
        conversation_cb=store,
    )
    return StreamingResponse(
        generator,
        media_type='text/event-stream; charset=utf-8',
        headers=SSE_HEADERS,
    )


@router.get('/messages')
async def chat_messages(
    user_id: UserId,
    conversation_id: str = Query(..., description='会话 ID'),
    application_id: str | None = Query(None),
    limit: int | None = Query(None),
    last_record_id: str | None = Query(None),
):
    """历史消息（V2 格式）。数据来自腾讯云 DescribeConversationMessageList。"""
    app = get_app(application_id)
    page_size = limit or get_settings().CHAT_MESSAGE_PAGE_SIZE
    try:
        result = await app.get_messages_v2(user_id, conversation_id, page_size, last_record_id)
    except UpstreamError as e:
        logging.error('[chat_messages] upstream error: %s', e)
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {
        'Response': {
            'ApplicationId': app.application_id,
            'Records': result['Records'],
            'HasMoreBefore': result['HasMoreBefore'],
            'LastRecordId': result['LastRecordId'],
        }
    }


@router.get('/conversations')
async def list_conversations(
    user_id: UserId,
    db: DbSession,
    application_id: str | None = Query(None),
):
    stmt = select(ChatConversation).where(ChatConversation.user_id == user_id)
    if application_id:
        stmt = stmt.where(ChatConversation.application_id == application_id)
    stmt = stmt.order_by(ChatConversation.last_active_at.desc())
    rows = (await db.execute(stmt)).scalars().all()
    return [row.to_dict() for row in rows]
