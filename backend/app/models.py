"""数据库表：
  - user：白名单（服务 B 不做认证，仅按 X-User-Id 判断是否有权使用）
  - chat_conversation：会话列表（历史消息本体在腾讯云，本地只存会话元信息）
  - agent_config：UserId + ApplicationId → AgentId（CopyAgentFromApp 结果缓存）
  - shared_conversation：分享快照
"""

import json
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _now_ms() -> int:
    return int(datetime.now(timezone.utc).timestamp() * 1000)


class User(Base):
    """白名单用户。通过 SQL 脚本维护，不提供管理接口。"""

    __tablename__ = 'user'

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default='allowed')  # allowed | blocked
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )

    @property
    def allowed(self) -> bool:
        return self.status == 'allowed'


class ChatConversation(Base):
    __tablename__ = 'chat_conversation'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    application_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(String(256), nullable=True)
    last_active_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=_now_ms)
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=_now_ms)

    def to_dict(self) -> dict:
        return {
            'Id': self.id,
            'UserId': self.user_id,
            'ApplicationId': self.application_id,
            'Title': self.title or '',
            'LastActiveAt': self.last_active_at,
            'CreatedAt': self.created_at,
        }


class AgentConfig(Base):
    """AgentId 缓存：一个用户在一个应用下只需要一份，用于 Skills/工具/连接器/知识库按钮。"""

    __tablename__ = 'agent_config'
    __table_args__ = (UniqueConstraint('user_id', 'application_id', name='uq_agent_user_app'),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    application_id: Mapped[str] = mapped_column(String(64), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False)

    def to_dict(self) -> dict:
        return {
            'ApplicationId': self.application_id,
            'AgentId': self.agent_id,
        }


class SharedConversation(Base):
    """分享快照：分享内容是历史记录的一份拷贝，脱离原会话独立存在。"""

    __tablename__ = 'shared_conversation'

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    application_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    parent_conversation_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str | None] = mapped_column(String(256), nullable=True)
    records_json: Mapped[str] = mapped_column(Text, nullable=False, default='[]')
    created_at: Mapped[int] = mapped_column(BigInteger, nullable=False, default=_now_ms)

    def records(self) -> list:
        try:
            return json.loads(self.records_json or '[]')
        except ValueError:
            return []

    def set_records(self, records: list) -> None:
        self.records_json = json.dumps(records, ensure_ascii=False)

    def to_dict(self) -> dict:
        return {
            'Id': self.id,
            'UserId': self.user_id,
            'ApplicationId': self.application_id,
            'ParentConversationId': self.parent_conversation_id,
            'Title': self.title or '',
            'Records': self.records(),
            'CreatedAt': self.created_at,
        }
