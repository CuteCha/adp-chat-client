"""引用详情：把 message 里的引用角标解析成来源文档。"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.deps import UserId
from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(prefix='/reference', tags=['reference'])


class ReferenceDetailBody(BaseModel):
    ApplicationId: str | None = None
    ShareId: str | None = None
    ReferenceIds: list[str] = Field(default_factory=list)


@router.post('/detail')
async def reference_detail(body: ReferenceDetailBody, user_id: UserId):
    if not body.ReferenceIds:
        return {'References': []}

    application_id = body.ApplicationId
    if not application_id:
        raise HTTPException(status_code=400, detail='ApplicationId is required')

    app = get_app(application_id)
    try:
        references = await app.get_reference_details(body.ReferenceIds)
    except UpstreamError as e:
        logging.error('[reference.detail] error=%s', e)
        raise HTTPException(status_code=502, detail=str(e)) from e
    return {'References': references}
