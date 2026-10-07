"""应用（智能体）注册表：ApplicationId -> TCADP 实例。"""

import logging

from fastapi import HTTPException

from app.config import get_settings
from app.tcadp import TCADP

_apps: dict[str, TCADP] = {}


def init_apps() -> None:
    _apps.clear()
    for config in get_settings().APP_CONFIGS:
        application_id = config.get('ApplicationId')
        if not application_id:
            continue
        _apps[str(application_id)] = TCADP(config, str(application_id))
    logging.info('[registry] loaded applications: %s', list(_apps))


def get_app(application_id: str | None = None) -> TCADP:
    """按 ApplicationId 取应用；未指定时返回第一个。"""
    if not _apps:
        init_apps()
    if not _apps:
        raise HTTPException(status_code=500, detail='APP_CONFIGS 未配置任何应用')
    if application_id:
        app = _apps.get(str(application_id))
        if app is None:
            raise HTTPException(status_code=404, detail=f'未知应用 {application_id}')
        return app
    return next(iter(_apps.values()))


def list_apps() -> list[TCADP]:
    if not _apps:
        init_apps()
    return list(_apps.values())
