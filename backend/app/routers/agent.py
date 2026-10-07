"""Agent 复制链路：AgentId 缓存的读写。

四个按钮（Skills / 工具 / 连接器 / 知识库）都需要先拿到一个可修改的 AgentId：
  POST /agent/copy   幂等：库里有就直接返回，没有才调 CopyAgentFromApp
  GET  /agent/config 读缓存
  DELETE /agent/config 清缓存（下次 copy 重新生成）
"""

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.db import DbSession
from app.deps import UserId
from app.models import AgentConfig
from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(prefix='/agent', tags=['agent'])


class CopyBody(BaseModel):
    ApplicationId: str


async def _get_config(db, user_id: str, application_id: str) -> AgentConfig | None:
    stmt = select(AgentConfig).where(
        AgentConfig.user_id == user_id,
        AgentConfig.application_id == application_id,
    )
    return (await db.execute(stmt)).scalars().first()


async def _save_config(db, user_id: str, application_id: str, agent_id: str) -> AgentConfig:
    record = await _get_config(db, user_id, application_id)
    if record is None:
        record = AgentConfig(
            user_id=user_id, application_id=application_id, agent_id=agent_id
        )
        db.add(record)
    else:
        record.agent_id = agent_id
    await db.commit()
    return record


@router.post('/copy')
async def copy_agent(body: CopyBody, user_id: UserId, db: DbSession):
    """返回该用户在该应用下可用的 AgentId（必要时才向上游复制一份）。"""
    app = get_app(body.ApplicationId)

    cached = await _get_config(db, user_id, body.ApplicationId)
    if cached and cached.agent_id:
        return {'Response': {'ApplicationId': body.ApplicationId, 'AgentId': cached.agent_id}}

    try:
        response = await app.forward_request(
            'CopyAgentFromApp',
            {'Kind': 1, 'AppId': body.ApplicationId},
        )
    except UpstreamError as e:
        logging.error('[agent.copy] CopyAgentFromApp failed: %s', e)
        raise HTTPException(status_code=502, detail=str(e)) from e

    agent_id = response.get('ParentAgentId') or response.get('AgentId') or ''
    if not agent_id:
        raise HTTPException(status_code=502, detail='CopyAgentFromApp 未返回 AgentId')

    await _save_config(db, user_id, body.ApplicationId, agent_id)
    return {'Response': {'ApplicationId': body.ApplicationId, 'AgentId': agent_id}}


@router.get('/config')
async def get_config(
    user_id: UserId,
    db: DbSession,
    application_id: str = Query(..., alias='ApplicationId'),
):
    record = await _get_config(db, user_id, application_id)
    return {
        'Response': {
            'ApplicationId': application_id,
            'AgentId': record.agent_id if record else None,
        }
    }


@router.delete('/config')
async def delete_config(
    user_id: UserId,
    db: DbSession,
    application_id: str = Query(..., alias='ApplicationId'),
):
    record = await _get_config(db, user_id, application_id)
    if record is not None:
        await db.delete(record)
        await db.commit()
    return {'Response': {'ApplicationId': application_id, 'AgentId': None}}
