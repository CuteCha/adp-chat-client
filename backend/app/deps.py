"""依赖：X-User-Id 白名单校验。

服务 B 不做登录鉴权：调用方在 header 里带 X-User-Id，
只要该 user_id 在 user 表中且 status='allowed' 即放行。
"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException
from sqlalchemy import select

from app.db import DbSession
from app.models import User


async def current_user_id(
    x_user_id: Annotated[str | None, Header(alias='X-User-Id')] = None,
    db: DbSession = None,
) -> str:
    if not x_user_id:
        raise HTTPException(status_code=403, detail='X-User-Id header is required')
    user = (await db.execute(select(User).where(User.user_id == x_user_id))).scalar_one_or_none()
    if user is None or not user.allowed:
        raise HTTPException(status_code=403, detail=f'user {x_user_id} is not allowed')
    return x_user_id


UserId = Annotated[str, Depends(current_user_id)]
