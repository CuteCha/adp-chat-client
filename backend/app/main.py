"""服务 B：腾讯云 ADP 智能体对话网关。

- 对系统 A 与调试前端暴露同一套 HTTP API，对话走 SSE 透传
- 不做登录鉴权：按 X-User-Id 白名单放行
- 注意：不要挂 GZipMiddleware —— 会缓冲 SSE 导致心跳与增量都失去实时性
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.registry import init_apps
from app.routers import (
    agent,
    application,
    chat,
    conversation,
    feedback,
    file,
    forward,
    health,
    reference,
    share,
    suggestion,
    user,
)

settings = get_settings()
logging.basicConfig(
    level=settings.LOG_LEVEL,
    format='%(asctime)s %(levelname)s %(name)s %(message)s',
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_apps()
    yield


app = FastAPI(
    title='ADP Chat Gateway',
    description='服务 B：对接腾讯云 ADP 智能体的对话网关（SSE 透传）',
    version='0.1.0',
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(',') if o.strip()],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
    expose_headers=['*'],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(conversation.router)
app.include_router(application.router)
app.include_router(user.router)

# M3：Agent 复制链路 + 通用转发（Skills / 工具 / 连接器 / 知识库）
app.include_router(forward.router)
app.include_router(agent.router)

# M4：文件 / 分享 / 反馈 / 引用详情 / 快捷提问
app.include_router(file.router)
app.include_router(share.router)
app.include_router(feedback.router)
app.include_router(reference.router)
app.include_router(suggestion.router)
