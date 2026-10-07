"""异步数据库会话。"""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

_engine = None
_session_factory = None


def _init():
    global _engine, _session_factory
    if _engine is None:
        _engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    _init()
    assert _session_factory is not None
    async with _session_factory() as session:
        yield session


async def create_all() -> None:
    """建表。生产环境建议改用 scripts/init_db.sql。"""
    _init()
    from app.models import Base

    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


DbSession = Annotated[AsyncSession, Depends(get_db)]
