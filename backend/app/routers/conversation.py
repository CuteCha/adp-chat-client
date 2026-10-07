"""会话 CRUD。历史消息本身在腾讯云，本地只维护会话元信息。"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from app.db import DbSession
from app.deps import UserId
from app.models import ChatConversation
from app.schemas import CreateConversationRequest, UpdateConversationRequest

router = APIRouter(prefix='/conversations', tags=['conversation'])


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


async def _get_owned(db, conversation_id: str, user_id: str) -> ChatConversation:
    conversation = await db.get(ChatConversation, conversation_id)
    if conversation is None or conversation.user_id != user_id:
        raise HTTPException(status_code=404, detail='会话不存在')
    return conversation


@router.get('')
async def list_conversations(user_id: UserId, db: DbSession):
    from sqlalchemy import select

    stmt = (
        select(ChatConversation)
        .where(ChatConversation.user_id == user_id)
        .order_by(ChatConversation.last_active_at.desc())
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [row.to_dict() for row in rows]


@router.post('')
async def create_conversation(body: CreateConversationRequest, user_id: UserId, db: DbSession):
    now = _now_ms()
    conversation = ChatConversation(
        id=uuid.uuid4().hex,
        user_id=user_id,
        application_id=body.ApplicationId,
        title=body.Title or '新对话',
        last_active_at=now,
        created_at=now,
    )
    db.add(conversation)
    await db.commit()
    return conversation.to_dict()


@router.patch('/{conversation_id}')
async def update_conversation(
    conversation_id: str, body: UpdateConversationRequest, user_id: UserId, db: DbSession
):
    conversation = await _get_owned(db, conversation_id, user_id)
    conversation.title = body.Title
    await db.commit()
    return conversation.to_dict()


@router.delete('/{conversation_id}')
async def delete_conversation(conversation_id: str, user_id: UserId, db: DbSession):
    conversation = await _get_owned(db, conversation_id, user_id)
    await db.delete(conversation)
    await db.commit()
    return {'Success': 1}
