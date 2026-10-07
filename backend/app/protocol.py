"""SSE 事件封装。

服务 B 对上游 V2 事件是「原样透传」，只在头尾注入两个自有事件：
  - conversation：会话创建 / 结束
  - error：上游异常、上游空闲超时
另外在空闲期间注入心跳帧，用于穿透 A 系统网关。
"""

import json
from typing import Any

from app.config import get_settings


def sse_frame(payload: dict[str, Any]) -> bytes:
    """把一个事件对象序列化为 SSE data 帧。"""
    return f'data: {json.dumps(payload, ensure_ascii=False)}\n\n'.encode('utf-8')


def conversation_event(conversation: dict[str, Any], is_new: bool = False) -> bytes:
    return sse_frame({'Type': 'conversation', 'Payload': {**conversation, 'IsNewConversation': is_new}})


def error_event(code: int, message: str) -> bytes:
    return sse_frame({'Type': 'error', 'Error': {'Code': code, 'Message': message}})


def heartbeat_frame() -> bytes:
    """SSE 保活帧。

    comment 模式：': ping\\n\\n' —— SSE 标准注释帧，所有 SSE 客户端天然忽略。
    event  模式：data 帧，供要求「必须见到 data: 」的网关使用；前端需忽略 Type=ping。
    """
    if get_settings().SSE_HEARTBEAT_MODE == 'event':
        return sse_frame({'Type': 'ping'})
    return b': ping\n\n'
