"""应用列表。"""

import asyncio
import logging

from fastapi import APIRouter

from app.registry import list_apps
from app.tcadp import UpstreamError

router = APIRouter(tags=['application'])


@router.get('/application/list')
async def application_list():
    apps = list_apps()
    results = await asyncio.gather(*[_safe_info(app) for app in apps])
    return results


async def _safe_info(app) -> dict:
    try:
        return await app.get_info()
    except UpstreamError as e:
        logging.error('[application_list] %s: %s', app.application_id, e)
        return {
            'ApplicationId': app.application_id,
            'Name': 'Unknown',
            'Greeting': '请检查 AppKey / TC_SECRET_ID / TC_SECRET_KEY 配置',
        }
