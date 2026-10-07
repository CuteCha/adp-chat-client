from pydantic import BaseModel, Field


class ChatMessageRequest(BaseModel):
    """POST /chat/message 请求体。

    Contents 直接透传给上游（[{"Type": "text", "Text": "..."}]），不做结构校验，
    避免上游新增内容类型时服务 B 成为瓶颈。
    """

    Contents: list[dict] = Field(default_factory=list)
    ConversationId: str | None = None
    ApplicationId: str | None = None
    CustomVariables: dict[str, str] | None = None


class CreateConversationRequest(BaseModel):
    Title: str = ''
    ApplicationId: str | None = None


class UpdateConversationRequest(BaseModel):
    Title: str
