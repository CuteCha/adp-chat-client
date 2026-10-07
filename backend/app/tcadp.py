"""腾讯云 ADP 客户端。

从 1616 行的 server/vendor/tcadp/tcadp.py 精简而来，保留以下能力（删除 scheduled task /
channel / openai_compatible 等无关分支）：
  - chat()：对话 SSE 透传
  - get_messages_v2()：历史消息（DescribeConversationMessageList，V2 格式）
  - get_info()：应用信息（供 /application/list）
  - forward_request()：任意腾讯云 Action 转发（Skills / 工具 / 连接器 / 知识库按钮）
  - upload() / parse_document()：文件上传与实时文档解析
  - list_dir() / download_file_content()：工作空间文件系统
  - rate() / get_reference_details()：反馈评分与引用详情
"""

import json
import logging
from collections import OrderedDict
from collections.abc import AsyncGenerator
from urllib.parse import parse_qs, urlparse

import aiohttp

from app.config import get_settings
from app.protocol import conversation_event, error_event
from app.tca import load_action_version_config, tc_request
from app.upstream import stream_sse


# 各 ServiceVendor 的端点配置（原 tcadp.py service_configs，去掉未使用的 cos）
SERVICE_CONFIGS = {
    'Private': {
        'lke': {'url': '{PrivateUrl}', 'region': 'ap-guangzhou'},
        'adp': {'url': '{PrivateUrl}', 'region': 'ap-guangzhou'},
        'lkeap': {'url': '{PrivateUrl}', 'region': 'ap-jakarta'},
        'sse': '{PrivateUrl}/v1/qbot/chat/sse',
    },
    'International': {
        'lke': {'url': 'https://lke.intl.tencentcloudapi.com', 'region': 'ap-jakarta'},
        'adp': {'url': 'https://adp.intl.tencentcloudapi.com', 'region': 'ap-jakarta'},
        'lkeap': {'url': 'https://lkeap.intl.tencentcloudapi.com', 'region': 'ap-jakarta'},
        'sse': 'https://wss.lke.tencentcloud.com/adp/v2/chat',
    },
    'ChinaTencentCloud': {
        'lke': {'url': 'https://lke.tencentcloudapi.com', 'region': 'ap-guangzhou'},
        'adp': {'url': 'https://adp.tencentcloudapi.com', 'region': 'ap-guangzhou'},
        'lkeap': {'url': 'https://lkeap.tencentcloudapi.com', 'region': 'ap-guangzhou'},
        'sse': 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    },
    'ChinaTencentADP': {
        'adp': {'url': 'https://capi.adp.tencent.com', 'region': 'ap-guangzhou'},
        'sse': 'https://wss.lke.cloud.tencent.com/adp/v2/chat',
    },
}

# AppMode 枚举 → Pattern 字符串（4 = ClawAgent）
_APP_MODE_MAP = {0: None, 1: 'standard', 2: 'agent', 3: 'single_workflow', 4: 'ClawAgent'}


class ConversationCallback:
    """会话创建 / 更新回调。路由层注入实现（内部持有 DB session 与 user_id）。"""

    async def create(self, title: str = '') -> dict:
        raise NotImplementedError

    async def update(self, conversation_id: str) -> dict | None:
        raise NotImplementedError


class TCADP:
    def __init__(self, config: dict, application_id: str = ''):
        self.config = config
        self.application_id = application_id
        vendor_key = config.get('ServiceVendor') or get_settings().SERVICE_VENDOR
        self._action_overrides = load_action_version_config(vendor_key)
        self._space_id = ''

    # ------------------------------------------------------------------
    # 端点配置
    # ------------------------------------------------------------------
    def tc_config(self) -> dict:
        settings = get_settings()
        key = self.config.get('ServiceVendor') or settings.SERVICE_VENDOR
        if key not in SERVICE_CONFIGS:
            logging.warning('[TCADP] unknown ServiceVendor "%s", fallback to ChinaTencentCloud', key)
            key = 'ChinaTencentCloud'
        config = json.loads(json.dumps(SERVICE_CONFIGS[key]))

        if key == 'Private':
            private_url = self.config.get('PrivateUrl', '')
            config = _replace_private_url(config, private_url)

        if key == 'ChinaTencentADP' and settings.ADP_SECRET_ID and settings.ADP_SECRET_KEY:
            config['secret_id'] = settings.ADP_SECRET_ID
            config['secret_key'] = settings.ADP_SECRET_KEY

        # 自定义 URL 覆盖
        for env_key, service in (
            ('CustomLkeUrl', 'lke'),
            ('CustomAdpUrl', 'adp'),
            ('CustomLkeapUrl', 'lkeap'),
        ):
            if self.config.get(env_key) and service in config:
                config[service]['url'] = self.config[env_key]
        if self.config.get('CustomSseUrl'):
            config['sse'] = self.config['CustomSseUrl']
        return config

    # ------------------------------------------------------------------
    # 对话
    # ------------------------------------------------------------------
    async def chat(
        self,
        user_id: str,
        contents: list[dict],
        conversation_id: str,
        is_new_conversation: bool,
        conversation_cb: ConversationCallback,
    ) -> AsyncGenerator[bytes, None]:
        """对话 SSE：新建会话事件 → 上游流（含心跳）→ 会话更新事件。"""
        if not contents:
            contents = [{'Type': 'text', 'Text': ''}]

        if is_new_conversation:
            conversation = await conversation_cb.create()
            conversation_id = conversation['Id']
            yield conversation_event(conversation, is_new=True)

        if not conversation_id:
            yield error_event(400, 'ConversationId is required')
            return

        param = {
            'ConversationId': conversation_id,
            'AppKey': self.config['AppKey'],
            'Contents': contents,
            'Incremental': True,
            'EnableMultiIntent': True,
            'VisitorId': user_id or 'anonymous',
            'Stream': 'enable',
        }
        logging.info('[TCADP.chat] ConversationId=%s VisitorId=%s', conversation_id, user_id)

        async for chunk in stream_sse(self.tc_config()['sse'], param):
            yield chunk

        # 流正常结束：刷新会话活跃时间，并回传 conversation 事件
        try:
            updated = await conversation_cb.update(conversation_id)
            if updated:
                yield conversation_event(updated, is_new=False)
        except Exception as e:  # noqa: BLE001 - 收尾失败不应影响已完成的对话
            logging.warning('[TCADP.chat] update conversation failed: %s', e)

    # ------------------------------------------------------------------
    # 历史消息
    # ------------------------------------------------------------------
    async def get_messages_v2(
        self, user_id: str, conversation_id: str, limit: int, last_record_id: str = None
    ) -> dict:
        """DescribeConversationMessageList，返回前端 V2 Record 分组。"""
        action = 'DescribeConversationMessageList'
        payload = {
            'ConversationId': conversation_id,
            'Limit': limit,
            'Type': 5,
            'UserId': user_id,
            'AppKey': self.config['AppKey'],
            'RecordQueryDirection': 1,
        }
        if last_record_id:
            payload['RecordId'] = last_record_id

        resp = await tc_request(self.tc_config(), action, payload, action_overrides=self._action_overrides)
        response = resp.get('Response', resp)
        if 'Error' in response:
            raise UpstreamError(response['Error'])

        return {
            'Records': _convert_messages_to_records(response.get('Messages', []), conversation_id),
            'HasMoreBefore': response.get('HasMoreBefore', False),
            'HasMoreAfter': response.get('HasMoreAfter', False),
            'FirstRecordId': response.get('FirstRecordId', ''),
            'LastRecordId': response.get('LastRecordId', ''),
        }

    # ------------------------------------------------------------------
    # 应用信息
    # ------------------------------------------------------------------
    async def get_info(self) -> dict:
        """DescribeRobotBizIDByAppKey + DescribeApp，返回应用元信息。"""
        resp = await tc_request(
            self.tc_config(),
            'DescribeRobotBizIDByAppKey',
            {'AppKey': self.config['AppKey']},
            action_overrides=self._action_overrides,
        )
        if 'Error' in resp['Response']:
            logging.error('[TCADP.get_info] %s', resp['Response']['Error'])
            raise UpstreamError(resp['Response']['Error'])

        app_id = resp['Response']['BotBizId']
        self.config['AppId'] = app_id

        resp = await tc_request(
            self.tc_config(),
            'DescribeApp',
            {'AppId': app_id, 'FieldMask': {'Paths': ['AppConfig']}},
            action_overrides=self._action_overrides,
        )
        if 'Error' in resp['Response']:
            logging.error('[TCADP.get_info] %s', resp['Response']['Error'])
            raise UpstreamError(resp['Response']['Error'])

        app = resp['Response'].get('App', {})
        metadata = app.get('Metadata', {})
        return {
            'ApplicationId': self.application_id,
            'Name': metadata.get('Name', ''),
            'Avatar': metadata.get('Avatar', ''),
            'Greeting': (app.get('Config', {}).get('Greeting') or {}).get('Greeting'),
            'Pattern': _APP_MODE_MAP.get(metadata.get('AppMode', 0)),
            'AppStatus': (app.get('Status') or {}).get('Status'),
            'SpaceId': metadata.get('SpaceId'),
        }

    async def get_space_id(self) -> str:
        """SpaceId：技能 / 工具 / 连接器广场接口的必填参数。

        前端拿不到这个值，转发层注入；取应用元信息后缓存。
        """
        if not self._space_id:
            info = await self.get_info()
            self._space_id = str(info.get('SpaceId') or '')
        return self._space_id


    # ------------------------------------------------------------------
    # 通用转发（Skills / 工具 / 连接器 / 知识库按钮都走它）
    # ------------------------------------------------------------------
    async def forward_request(
        self,
        action: str,
        payload: dict = None,
        service: str = None,
        *,
        response_key: str = None,
        raise_on_error: bool = True,
        variables: dict = None,
    ) -> dict:
        """把任意腾讯云 Action 转发给上游，service / version 由 action_version 配置决定。"""
        payload = payload or {}
        logging.info('[TCADP.forward_request] action=%s payload=%s', action, payload)
        resp = await tc_request(
            self.tc_config(),
            action,
            payload,
            service,
            variables=variables,
            action_overrides=self._action_overrides,
        )
        response = resp.get('Response', resp)
        if 'Error' in response:
            logging.error('[TCADP.forward_request] action=%s error=%s', action, response['Error'])
            if raise_on_error:
                raise UpstreamError(response['Error'].get('Message', str(response['Error'])))
            return response
        return response.get(response_key) if response_key is not None else response

    # ------------------------------------------------------------------
    # 文件
    # ------------------------------------------------------------------
    async def upload(self, file_data: bytes, mime_type: str, mode: str = 'standard') -> dict:
        """DescribeStorageCredential 拿预签名地址 → PUT 到 COS。返回 {Url, CosUrl, CosBucket}。"""
        action = 'DescribeStorageCredential'
        file_type = self._resolve_file_type(mime_type)
        # claw/agent 模式使用 BotBizId='0' + IsPublic=True，确保文件在公有桶中可被 Claw Agent 下载
        app_id = '0' if mode == 'claw' else self.config.get('AppId', '')
        payload = {
            'AppId': app_id,
            'FileType': file_type,
            'IsPublic': True,
            'TypeKey': 'realtime',
        }
        resp = (
            await tc_request(
                self.tc_config(), action, payload, action_overrides=self._action_overrides
            )
        )['Response']
        if 'Error' in resp:
            raise UpstreamError(resp['Error'].get('Message', 'DescribeStorageCredential failed'))

        # 新协议把路径放在 StoragePath 子对象里，展平到顶层以保持后续取值一致
        storage_path = resp.get('StoragePath')
        if isinstance(storage_path, dict):
            for key in ('FilePath', 'FileUrl', 'ImagePath', 'UploadPath', 'UploadUrl', 'DownloadUrl'):
                if key in storage_path and key not in resp:
                    resp[key] = storage_path[key]
        elif isinstance(storage_path, str) and storage_path and 'UploadPath' not in resp:
            resp['UploadPath'] = storage_path

        cos_content_type = (mime_type or '').split(';', 1)[0].strip().lower()
        if '/' not in cos_content_type:
            cos_content_type = 'application/octet-stream'

        upload_url = resp.get('UploadUrl')
        if not upload_url:
            raise UpstreamError('DescribeStorageCredential 未返回 UploadUrl')

        # 预签名地址已经锁定了参与签名的 header，content-type 被签名时不能覆盖
        signed_set = set()
        try:
            query = parse_qs(urlparse(upload_url).query)
            signed_set = {h.strip() for h in query.get('q-signed-headers', [''])[0].lower().split(';') if h.strip()}
        except Exception:  # noqa: BLE001 - 解析失败按未签名处理
            signed_set = set()

        put_headers = {'Content-Length': str(len(file_data))}
        if 'content-type' not in signed_set:
            put_headers['Content-Type'] = cos_content_type

        async with aiohttp.ClientSession() as session:
            async with session.put(upload_url, data=file_data, headers=put_headers) as put_resp:
                if put_resp.status not in (200, 201, 204):
                    text = await put_resp.text()
                    logging.error('[TCADP.upload] PUT failed: status=%s body=%s', put_resp.status, text)
                    raise UpstreamError(f'文件上传失败: {put_resp.status}')

        cos_url = resp.get('UploadPath', '')
        url = resp.get('FileUrl') or resp.get('file_url') or (
            f"https://{resp['Bucket']}.cos.{resp['Region']}.myqcloud.com{cos_url}"
        )

        # claw 模式：上传后必须再取一次 DownloadUrl，否则 Agent 侧读不到文件
        if mode == 'claw' and cos_url:
            try:
                dl_resp = (
                    await tc_request(
                        self.tc_config(),
                        action,
                        {'AppId': '0', 'FileType': file_type, 'IsPublic': True,
                         'TypeKey': 'realtime', 'CosUrl': cos_url},
                        action_overrides=self._action_overrides,
                    )
                )['Response']
                dl_storage = dl_resp.get('StoragePath') or {}
                download_url = (
                    dl_resp.get('DownloadUrl')
                    or dl_storage.get('FileUrl')
                    or dl_resp.get('FileUrl')
                )
                if download_url:
                    url = download_url
            except Exception as e:  # noqa: BLE001 - 拿不到 DownloadUrl 时退回 FileUrl
                logging.warning('[TCADP.upload] 获取 DownloadUrl 失败: %s', e)

        return {'Url': url, 'CosUrl': cos_url, 'CosBucket': resp.get('Bucket', '')}

    async def parse_document(
        self,
        file_name: str,
        file_type: str,
        cos_bucket: str = '',
        cos_url: str = '',
        e_tag: str = '',
        cos_hash: str = '',
        size: str = '0',
        conversation_id: str = '',
    ) -> AsyncGenerator[bytes, None]:
        """LKE 实时文档解析：代理 /v1/qbot/chat/docParse 的 SSE 流，用于取 doc_id。"""
        tc_cfg = self.tc_config()
        sse_base = tc_cfg['sse']
        for marker in ('/adp/', '/v1/'):
            if marker in sse_base:
                sse_base = sse_base.rsplit(marker, 1)[0]
                break
        doc_parse_url = f'{sse_base}/v1/qbot/chat/docParse'

        data = {
            'cos_bucket': cos_bucket,
            'file_type': file_type,
            'file_name': file_name,
            'cos_url': cos_url,
            'e_tag': e_tag,
            'cos_hash': cos_hash,
            'size': size,
            'bot_app_key': self.config['AppKey'],
        }
        if conversation_id:
            data['session_id'] = conversation_id

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120)) as session:
            async with session.post(
                doc_parse_url,
                headers={'Content-Type': 'application/json', 'Accept': 'text/event-stream'},
                data=json.dumps(data),
            ) as resp:
                if resp.status != 200:
                    text = await resp.text()
                    logging.error('[TCADP.parse_document] status=%s body=%s', resp.status, text)
                    yield b'data: ' + json.dumps(
                        {'type': 'error', 'payload': {'doc_id': '0', 'process': 0,
                                                      'status': 'FAILED',
                                                      'error_message': f'Parse request failed: {resp.status}'}}
                    ).encode('utf-8') + b'\n\n'
                    return
                async for line in resp.content:
                    decoded = line.decode('utf-8')
                    if decoded.strip():
                        yield decoded.encode('utf-8') if decoded.endswith('\n') else f'{decoded}\n'.encode('utf-8')

    # ------------------------------------------------------------------
    # 工作空间（远程沙箱文件系统）
    # ------------------------------------------------------------------
    async def _workspace_credential(self, app_id: str, workspace_id: str) -> tuple[str, str, str]:
        response = await self.forward_request(
            'CreateWorkspaceCredential',
            {'AppId': app_id, 'Type': 2, 'WorkspaceId': workspace_id},
        )
        credential = response.get('Credential') or {}
        sandbox = response.get('SandboxStorage') or {}
        access_token = credential.get('AccessToken', '')
        domain = sandbox.get('Domain', '')
        token_tag = sandbox.get('TokenTag', '')
        if not (access_token and domain and token_tag):
            raise UpstreamError('CreateWorkspaceCredential 返回数据不完整')
        return domain, token_tag, access_token

    async def list_dir(self, app_id: str, path: str, depth: int = 1, workspace_id: str = '') -> dict:
        domain, token_tag, access_token = await self._workspace_credential(app_id, workspace_id)
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f'{domain}/filesystem.Filesystem/ListDir',
                json={'path': path, 'depth': depth},
                headers={'Content-Type': 'application/json', token_tag: access_token},
                ssl=False,
            ) as resp:
                data = await resp.json()
                if resp.status != 200:
                    raise UpstreamError(f'ListDir failed: {resp.status} {data}')
                return data

    async def download_file_content(
        self, app_id: str, workspace_id: str, path: str
    ) -> tuple[bytes, str, str]:
        """下载沙箱文件内容，返回 (bytes, content_type, file_name)。"""
        domain, token_tag, access_token = await self._workspace_credential(app_id, workspace_id)
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f'{domain}/files', params={'path': path}, headers={token_tag: access_token}, ssl=False
            ) as resp:
                content = await resp.read()
                if resp.status != 200:
                    raise UpstreamError(
                        f'download failed: {resp.status} {content.decode("utf-8", "replace")[:200]}'
                    )
                file_name = path.rsplit('/', 1)[-1] if '/' in path else path
                return content, resp.headers.get('Content-Type', 'application/octet-stream'), file_name

    # ------------------------------------------------------------------
    # 反馈 / 引用详情
    # ------------------------------------------------------------------
    async def rate(self, record_id: str, score: int) -> None:
        response = await self.forward_request(
            'RateMsgRecord',
            {'RecordId': record_id, 'Score': score, 'BotAppKey': self.config['AppKey']},
            raise_on_error=False,
        )
        if 'Error' in response:
            raise UpstreamError(response['Error'].get('Message', 'RateMsgRecord failed'))

    async def get_reference_details(self, reference_ids: list[str]) -> list[dict]:
        unique_ids = list(dict.fromkeys([rid for rid in reference_ids if rid]))
        if not unique_ids:
            return []
        response = await self.forward_request(
            'DescribeRefer',
            {'BotBizId': self.config.get('AppId', ''), 'ReferBizIds': unique_ids},
        )
        detail_map = {}
        for item in response.get('List', []):
            detail = dict(item)
            refer_biz_id = detail.get('ReferBizId')
            if refer_biz_id and 'Id' not in detail:
                detail['Id'] = refer_biz_id
            if detail.get('DocName') and 'Name' not in detail:
                detail['Name'] = detail['DocName']
            detail_id = detail.get('Id', refer_biz_id)
            if detail_id:
                detail_map[detail_id] = detail
        return [detail_map[rid] for rid in unique_ids if rid in detail_map]

    @staticmethod
    def _resolve_file_type(mime_type: str) -> str:
        """MIME → DescribeStorageCredential 接受的扩展名。"""
        mime_to_ext = {
            'image/png': 'png',
            'image/jpg': 'jpg',
            'image/jpeg': 'jpeg',
            'image/bmp': 'bmp',
            'image/webp': 'webp',
            'image/gif': 'gif',
            'image/tiff': 'tiff',
            'application/pdf': 'pdf',
            'application/msword': 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
            'application/vnd.ms-powerpoint': 'ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
            'application/vnd.ms-excel': 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
            'text/plain': 'txt',
            'text/markdown': 'md',
            'text/csv': 'csv',
            'application/json': 'json',
        }
        if mime_type in mime_to_ext:
            return mime_to_ext[mime_type]
        return mime_type.split('/')[-1]


class UpstreamError(Exception):
    """上游返回 Error 时抛出。"""


def _replace_private_url(config: dict, private_url: str) -> dict:
    for key, value in config.items():
        if isinstance(value, str):
            config[key] = value.replace('{PrivateUrl}', private_url)
        elif isinstance(value, dict):
            config[key] = _replace_private_url(value, private_url)
    return config


def _convert_messages_to_records(messages: list, conversation_id: str) -> list:
    """把上游消息列表转成前端 V2 Record 格式（按 RecordId 分组）。

    上游可能直接返回已分组的 Record 格式（含 Messages 数组），此时原样透传。
    """
    if not messages:
        return []

    first = messages[0]
    if 'Messages' in first and isinstance(first.get('Messages'), list):
        return messages

    groups: OrderedDict = OrderedDict()
    scores: dict[str, int] = {}

    for msg in messages:
        record_id = msg.get('RecordId', '')
        if not record_id:
            continue
        if record_id not in groups:
            groups[record_id] = {
                'Role': msg.get('Role', 'assistant'),
                'RecordId': record_id,
                'ConversationId': msg.get('ConversationId', conversation_id),
                'Status': msg.get('Status', 'completed'),
                'StatusDesc': msg.get('StatusDesc', ''),
                'Messages': [],
                'ExtraInfo': msg.get('ExtraInfo'),
            }
        if msg.get('Score'):
            scores[record_id] = msg['Score']
        groups[record_id]['Messages'].append(
            {
                'Type': msg.get('Type', 'reply'),
                'MessageId': msg.get('MessageId', ''),
                'Name': msg.get('Name', ''),
                'Title': msg.get('Title', ''),
                'Icon': msg.get('Icon', ''),
                'Status': msg.get('Status', 'completed'),
                'StatusDesc': msg.get('StatusDesc', ''),
                'Contents': msg.get('Contents', []),
                'ExtraInfo': msg.get('ExtraInfo'),
            }
        )

    for record_id, score in scores.items():
        groups[record_id]['Score'] = score
    return list(groups.values())
