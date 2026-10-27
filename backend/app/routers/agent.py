"""Agent 信息：读取应用自身（独立构建）的 Agent。

项目不再使用「从应用复制出来的 Agent」——所有能力（Skills / 工具 / 连接器 /
知识库）都直接读写应用自己的那份 Agent：

  POST /agent/info   返回该应用的 AgentId（幂等，上游就是同一个 Agent）

DescribeAgentDetail 不传 AgentId、只传 AppId 时，上游返回的就是应用在腾讯云
ADP 平台上的那份配置（含 AgentId / SkillList / PluginList / ToolList），
面板里的增删改也直接作用于它，因此不存在「副本与平台不一致」需要同步的问题。
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(prefix='/agent', tags=['agent'])


class AgentInfoBody(BaseModel):
    ApplicationId: str


@router.post('/info')
async def get_agent_info(body: AgentInfoBody):
    """返回应用自身 Agent 的 AgentId。"""
    app = get_app(body.ApplicationId)
    try:
        response = await app.forward_request(
            'DescribeAgentDetail',
            {'AppId': body.ApplicationId, 'Domain': 2},
        )
    except UpstreamError as e:
        logging.warning('[agent.info] DescribeAgentDetail failed: %s', e)
        raise HTTPException(status_code=502, detail=str(e)) from e

    agent = response.get('Agent') or response
    agent_id = str(agent.get('AgentId') or '')
    if not agent_id:
        raise HTTPException(status_code=502, detail='DescribeAgentDetail 未返回 AgentId')

    return {'Response': {'ApplicationId': body.ApplicationId, 'AgentId': agent_id}}
