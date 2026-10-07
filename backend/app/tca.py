"""腾讯云 API V3（TC3-HMAC-SHA256）签名与请求。

仅用于管理类接口（DescribeApp / DescribeConversationMessageList 等）。
对话 SSE 走 AppKey，不需要签名。

从原项目 server/util/tca.py 精简而来：去掉 ASR 签名、SSE 签名请求等未使用分支。
"""

import hashlib
import hmac
import json
import logging
import os
import re
from datetime import datetime, timezone

import aiohttp
import pydash

from app.config import get_settings

_ACTION_VERSION_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'action_version')

_TEMPLATE_PATTERN = re.compile(r'\{\{(\w+)\}\}')


# ---------------------------------------------------------------------------
# action_version 配置：每个 ServiceVendor 一套 JSON，提供 service / X-TC-Version / 默认 payload
# ---------------------------------------------------------------------------

def _parse_action_version_raw(config: dict) -> dict:
    result = {}
    for action, value in config.items():
        if action.startswith('_') or not isinstance(value, dict):
            continue
        headers, payload_paths, service = {}, {}, None
        for k, v in value.items():
            if k == 'service':
                service = v
            elif k.startswith('headers.'):
                headers[k[len('headers.'):]] = v
            elif k.startswith('payload.'):
                payload_paths[k[len('payload.'):]] = v
        result[action] = {'headers': headers, 'payload': payload_paths, 'service': service}
    return result


def load_action_version_config(vendor_key: str) -> dict:
    path = os.path.join(_ACTION_VERSION_DIR, f'{vendor_key}.json')
    if not os.path.exists(path):
        logging.warning('[tca] action_version/%s.json not found', vendor_key)
        return {}
    try:
        with open(path, encoding='utf-8') as f:
            return _parse_action_version_raw(json.load(f))
    except (OSError, ValueError) as e:
        logging.warning('[tca] failed to load action_version/%s.json: %s', vendor_key, e)
        return {}


def _render_template(value, variables: dict):
    if not isinstance(value, str):
        return value
    full = _TEMPLATE_PATTERN.fullmatch(value.strip())
    if full:
        return variables.get(full.group(1), value)
    return _TEMPLATE_PATTERN.sub(lambda m: str(variables.get(m.group(1), m.group(0))), value)


def inject_action_payload(action: str, payload: dict, variables: dict, action_overrides: dict) -> dict:
    paths = (action_overrides or {}).get(action, {}).get('payload', {})
    for path, raw in paths.items():
        if not pydash.has(payload, path):
            pydash.set_(payload, path, _render_template(raw, variables or {}))
    return payload


def _resolve_service(action: str, action_overrides: dict) -> str:
    return (action_overrides or {}).get(action, {}).get('service') or 'lke'


# ---------------------------------------------------------------------------
# 签名
# ---------------------------------------------------------------------------

def _sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode('utf-8'), hashlib.sha256).digest()


def tc_request_prepare(
    config: dict,
    action: str,
    payload: str,
    service: str,
    action_overrides: dict = None,
) -> tuple[dict, str]:
    settings = get_settings()
    secret_id = config.get('secret_id') or settings.TC_SECRET_ID
    secret_key = config.get('secret_key') or settings.TC_SECRET_KEY

    url = config[service]['url']
    host = url.split('//')[1].split('/')[0]
    overrides = action_overrides or {}
    action_headers = overrides.get(action, {}).get('headers', {})
    region = action_headers.get('X-TC-Region') or config[service].get('region', '')

    algorithm = 'TC3-HMAC-SHA256'
    timestamp = int(datetime.now(timezone.utc).timestamp())
    date = datetime.fromtimestamp(timestamp, timezone.utc).strftime('%Y-%m-%d')

    content_type = 'application/json; charset=utf-8'
    canonical_headers = f'content-type:{content_type}\nhost:{host}\nx-tc-action:{action.lower()}\n'
    signed_headers = 'content-type;host;x-tc-action'
    hashed_payload = hashlib.sha256(payload.encode('utf-8')).hexdigest()
    canonical_request = '\n'.join(
        ['POST', '/', '', canonical_headers, signed_headers, hashed_payload]
    )

    credential_scope = f'{date}/{service}/tc3_request'
    string_to_sign = '\n'.join(
        [
            algorithm,
            str(timestamp),
            credential_scope,
            hashlib.sha256(canonical_request.encode('utf-8')).hexdigest(),
        ]
    )

    secret_date = _sign(('TC3' + secret_key).encode('utf-8'), date)
    secret_service = _sign(secret_date, service)
    secret_signing = _sign(secret_service, 'tc3_request')
    signature = hmac.new(secret_signing, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()

    headers = {
        'Authorization': (
            f'{algorithm} Credential={secret_id}/{credential_scope}, '
            f'SignedHeaders={signed_headers}, Signature={signature}'
        ),
        'Content-Type': content_type,
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Timestamp': str(timestamp),
    }
    default_version = action_headers.get('X-TC-Version')
    if default_version:
        headers['X-TC-Version'] = default_version
    if region:
        headers['X-TC-Region'] = region
    if settings.TC_CANARY_HEADER:
        headers['X-TC-Canary'] = settings.TC_CANARY_HEADER
    headers.update(action_headers)  # action 级配置优先级最高
    return headers, url


async def tc_request(
    config: dict,
    action: str,
    payload: dict = None,
    service: str = None,
    variables: dict = None,
    action_overrides: dict = None,
) -> dict:
    """发起一次腾讯云 API 请求，返回响应 dict（含 Response 字段）。"""
    service = service or _resolve_service(action, action_overrides)
    payload = inject_action_payload(action, payload or {}, variables or {}, action_overrides)
    body = json.dumps(payload)
    headers, url = tc_request_prepare(config, action, body, service, action_overrides)

    logging.info('[tc_request] POST %s action=%s service=%s payload=%s', url, action, service, body)
    async with aiohttp.ClientSession() as session:
        async with session.post(f'{url}/', headers=headers, data=body) as resp:
            try:
                return await resp.json()
            except aiohttp.ContentTypeError:
                text = await resp.text()
                logging.error(
                    '[tc_request] non-JSON response: status=%s content_type=%s body=%s',
                    resp.status, resp.content_type, text[:500],
                )
                return {
                    'Response': {
                        'Error': {
                            'Code': 'InvalidResponse',
                            'Message': f'Non-JSON response (status={resp.status})',
                        }
                    }
                }
