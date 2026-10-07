"""反馈：点赞/点踩（RateMsgRecord）。"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.deps import UserId
from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(prefix='/feedback', tags=['feedback'])


class RateBody(BaseModel):
    ApplicationId: str
    ConversationId: str | None = None
    RecordId: str
    Score: int


@router.post('/rate')
async def rate(body: RateBody, user_id: UserId):
    app = get_app(body.ApplicationId)
    try:
        await app.rate(body.RecordId, body.Score)
    except UpstreamError as e:
        logging.error('[feedback.rate] record=%s score=%s error=%s', body.RecordId, body.Score, e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {'Success': 1}
