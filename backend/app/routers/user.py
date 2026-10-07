"""白名单查询。

供系统 A 前端判断「是否显示调用服务 B 的按钮」：
    GET /users/{user_id}/allowed -> {"user_id": "u1", "allowed": true}
白名单本身通过 SQL 脚本维护（见 scripts/user.sql），不提供管理接口。
"""

from fastapi import APIRouter
from sqlalchemy import select

from app.db import DbSession
from app.models import User

router = APIRouter(prefix='/users', tags=['user'])


@router.get('/{user_id}/allowed')
async def is_allowed(user_id: str, db: DbSession):
    user = (await db.execute(select(User).where(User.user_id == user_id))).scalar_one_or_none()
    return {'user_id': user_id, 'allowed': user is not None and user.allowed}
