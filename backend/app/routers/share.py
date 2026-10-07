"""分享：把历史记录做成一份快照，脱离原会话独立存在。"""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db import DbSession
from app.deps import UserId
from app.models import SharedConversation

router = APIRouter(prefix='/share', tags=['share'])


class CreateShareBody(BaseModel):
    ApplicationId: str | None = None
    ConversationId: str | None = None
    Title: str | None = None
    Records: list = Field(default_factory=list)


@router.post('/create')
async def create_share(body: CreateShareBody, user_id: UserId, db: DbSession):
    shared = SharedConversation(
        id=uuid.uuid4().hex,
        user_id=user_id,
        application_id=body.ApplicationId,
        parent_conversation_id=body.ConversationId,
        title=body.Title or '分享的对话',
        created_at=int(datetime.now(timezone.utc).timestamp() * 1000),
    )
    shared.set_records(body.Records)
    db.add(shared)
    await db.commit()
    return {'Response': {'Id': shared.id}}


@router.get('/{share_id}')
async def get_share(share_id: str, db: DbSession):
    """分享页读取：无需 X-User-Id（分享链接是给外部看的）。"""
    shared = await db.get(SharedConversation, share_id)
    if shared is None:
        raise HTTPException(status_code=404, detail='分享不存在或已删除')
    data = shared.to_dict()
    return {
        'Response': {
            'ApplicationId': data['ApplicationId'],
            'Title': data['Title'],
            'ConversationId': data['ParentConversationId'],
            'Records': data['Records'],
            'CreatedAt': data['CreatedAt'],
        }
    }
