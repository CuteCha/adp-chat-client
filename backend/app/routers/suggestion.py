"""快捷提问（输入框上方的推荐语）。"""

from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix='/suggestions', tags=['suggestion'])


@router.get('')
async def list_suggestions():
    return {'Response': {'GroupList': get_settings().SUGGESTION_CONFIGS}}
