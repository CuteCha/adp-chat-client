"""通用腾讯云 API 转发：POST /adp/{action}。

Skills / 工具 / 连接器 / 知识库四个按钮的所有增删改都走这个端点，
前端只需传 Action 名 + Payload，service / version 由 action_version 配置决定。
"""

import logging
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.deps import UserId
from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(tags=['forward'])

# Action 白名单正则：防止把任意路径注入到 X-TC-Action
ACTION_PATTERN = re.compile(r'^[A-Za-z][A-Za-z0-9]{1,128}$')

# 这些广场类接口上游要求 SpaceId（应用所属空间），前端拿不到，由后端注入
_NEED_SPACE_ID = {'DescribeSkillSummaryList', 'DescribePluginSummaryList'}


class ForwardBody(BaseModel):
    ApplicationId: str
    Payload: dict = Field(default_factory=dict)


@router.post('/adp/{action}')
async def forward(action: str, body: ForwardBody, user_id: UserId):
    if not ACTION_PATTERN.match(action):
        raise HTTPException(status_code=400, detail=f'Invalid Action name: {action}')

    app = get_app(body.ApplicationId)
    if action in _NEED_SPACE_ID and not str(body.Payload.get('SpaceId') or ''):
        body.Payload['SpaceId'] = await app.get_space_id()
    variables = {
        'APP_KEY': app.config.get('AppKey', ''),
        'ACCOUNT_ID': user_id,
        'ApplicationId': body.ApplicationId,
        'AppId': app.config.get('AppId', ''),
    }

    logging.info('[forward] Action=%s ApplicationId=%s', action, body.ApplicationId)
    try:
        # raise_on_error=False：上游 Error 原样回给前端，由前端展示具体原因
        response = await app.forward_request(
            action, body.Payload, variables=variables, raise_on_error=False
        )
    except UpstreamError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return {'Response': response}
