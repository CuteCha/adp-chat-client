"""服务 B 配置。

只保留 M1+M2 真正需要的配置项，全部通过环境变量注入（.env 不入库）。
"""

from functools import lru_cache
from typing import Literal
from urllib.parse import quote

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', env_file_encoding='utf-8', extra='ignore')

    # ------------------------------------------------------------------
    # 腾讯云密钥
    # 仅管理类接口（DescribeApp / DescribeConversationMessageList 等）走 V3 签名；
    # 对话 SSE 只用 AppKey，不需要签名。
    # ------------------------------------------------------------------
    TC_SECRET_ID: str = ''
    TC_SECRET_KEY: str = ''
    ADP_SECRET_ID: str = ''  # ServiceVendor=ChinaTencentADP 时使用
    ADP_SECRET_KEY: str = ''
    TC_CANARY_HEADER: str = ''

    # ------------------------------------------------------------------
    # 应用
    # ------------------------------------------------------------------
    APP_CONFIGS: list[dict] = Field(
        default_factory=list,
        description='[{"ApplicationId": "...", "AppKey": "...", "Name": "智能体02"}]',
    )
    SERVICE_VENDOR: str = Field(
        default='ChinaTencentCloud',
        description='ChinaTencentCloud | ChinaTencentADP | International | Private',
    )

    # 快捷提问（原 SUGGESTION_CONFIGS，直接返回 DescribePromptSuggestionList 结构）
    SUGGESTION_CONFIGS: list[dict] = Field(default_factory=list)

    # ------------------------------------------------------------------
    # 上游 SSE
    # ------------------------------------------------------------------
    SSE_IDLE_TIMEOUT: int = Field(
        default=5400,
        description='上游两条数据之间的最大空闲秒数，超过则下发 error(504) 并关流',
    )
    SSE_HEARTBEAT_INTERVAL: int = Field(
        default=15,
        description='SSE 保活心跳间隔秒数，用于穿透 A 系统网关的空闲断连',
    )
    SSE_HEARTBEAT_MODE: Literal['comment', 'event'] = Field(
        default='comment',
        description="comment: 发送 ': ping' 注释帧；event: 发送 data:{\"Type\":\"ping\"} 数据帧",
    )

    # ------------------------------------------------------------------
    # 数据库
    # ------------------------------------------------------------------
    DATABASE_URL: str = ''
    PGSQL_HOST: str = ''
    PGSQL_PORT: int = 5432
    PGSQL_DB: str = ''
    PGSQL_USER: str = ''
    PGSQL_PASSWORD: str = ''

    # ------------------------------------------------------------------
    # 其它
    # ------------------------------------------------------------------
    CHAT_MESSAGE_PAGE_SIZE: int = 20
    CORS_ORIGINS: str = '*'
    LOG_LEVEL: str = 'INFO'

    @property
    def database_url(self) -> str:
        if self.DATABASE_URL:
            return self.DATABASE_URL
        if self.PGSQL_HOST and self.PGSQL_DB:
            return (
                f'postgresql+asyncpg://{self.PGSQL_USER}:{quote(self.PGSQL_PASSWORD)}'
                f'@{self.PGSQL_HOST}:{self.PGSQL_PORT}/{self.PGSQL_DB}'
            )
        raise RuntimeError('请配置 DATABASE_URL 或 PGSQL_HOST/PGSQL_DB/...')


@lru_cache
def get_settings() -> Settings:
    return Settings()
