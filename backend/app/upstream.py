"""上游 SSE 客户端。

职责（原 Sanic 版散落在 server/vendor/tcadp/tcadp.py:879-1013）：
  1. 转发上游 text/event-stream 的 data 帧
  2. 空闲期间发心跳，穿透 A 系统网关的空闲断连
  3. 上游超过 SSE_IDLE_TIMEOUT 没有数据 → 下发 error(504)，不静默断流
  4. 客户端断开 → 立即 abort 上游 TCP，回收资源
"""

import asyncio
import json
import logging
import time
from collections.abc import AsyncGenerator

import aiohttp

from app.config import get_settings
from app.protocol import error_event, heartbeat_frame

_HEADERS = {'Accept': 'text/event-stream', 'Content-Type': 'application/json'}


def _abort(resp: aiohttp.ClientResponse) -> None:
    """强制关闭底层 TCP，让上游立即感知断开。"""
    try:
        if resp.connection is not None and resp.connection.transport is not None:
            resp.connection.transport.abort()
        resp.close()
    except Exception as e:  # noqa: BLE001 - 关闭阶段的异常不应影响主流程
        logging.warning('[upstream] abort upstream failed: %s', e)


async def stream_sse(sse_url: str, param: dict) -> AsyncGenerator[bytes, None]:
    """连接上游 SSE 并逐帧转发，空闲时插入心跳。"""
    settings = get_settings()
    timeout = aiohttp.ClientTimeout(total=None, sock_read=settings.SSE_IDLE_TIMEOUT)
    session = aiohttp.ClientSession(read_bufsize=1 * 1024 * 1024, timeout=timeout)

    try:
        async with session.post(sse_url, headers=_HEADERS, data=json.dumps(param)) as resp:
            if resp.status != 200:
                logging.error('[upstream] upstream SSE status=%s', resp.status)
                yield error_event(resp.status, f'upstream SSE error: {resp.status}')
                return

            last_data_at = time.monotonic()
            while True:
                try:
                    raw = await asyncio.wait_for(
                        resp.content.readline(), timeout=settings.SSE_HEARTBEAT_INTERVAL
                    )
                except asyncio.TimeoutError:
                    # 这一个心跳周期内上游没吐数据：发保活帧
                    yield heartbeat_frame()
                    if time.monotonic() - last_data_at > settings.SSE_IDLE_TIMEOUT:
                        logging.warning(
                            '[upstream] idle timeout after %ss, closing', settings.SSE_IDLE_TIMEOUT
                        )
                        yield error_event(
                            504, f'upstream SSE idle timeout after {settings.SSE_IDLE_TIMEOUT}s'
                        )
                        return
                    continue
                except asyncio.CancelledError:
                    logging.info('[upstream] client disconnected, aborting upstream')
                    _abort(resp)
                    raise

                if not raw:
                    break
                last_data_at = time.monotonic()

                line = raw.decode('utf-8', errors='ignore')
                if not line.startswith('data:'):
                    continue
                payload = line[len('data:'):].strip()
                if not payload or payload == '[DONE]':
                    continue
                yield f'data: {payload}\n\n'.encode('utf-8')

            logging.info('[upstream] stream finished')
    except asyncio.CancelledError:
        raise
    finally:
        await session.close()
