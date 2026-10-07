/**
 * ADP chat protocol v2 —— 从 client/packages/adp-chat-component/src/model/chat-v2.ts 精简而来。
 * 只保留渲染所需字段；其余上游字段运行时原样携带，不参与类型约束。
 */

export type NumberLike = number | string
export type RecordRole = 'user' | 'assistant'
export type ContentType =
  | 'text'
  | 'image'
  | 'widget'
  | 'file'
  | 'custom_variables'
  | 'widget_action'
  | 'json_text'
  /** 反问澄清卡片 */
  | 'questionnaire'
export type MessageType =
  | 'reply'
  | 'thought'
  | 'tool_call'
  | 'task_execution'
  | 'recommendation'
  | 'notice'
  | 'question'

export interface Reference {
  Index?: number
  Type?: number
  Name?: string
  Id?: string
  Url?: string
  DocName?: string
  DocRefer?: { ReferBizId: string; DocBizId: string; DocName: string; Url: string }
  QaRefer?: { ReferBizId: string; QaBizId: string }
  WebSearchRefer?: { Url: string }
}

export interface Content {
  Type: ContentType
  Text?: string
  File?: { FileName: string; FileSize: string; FileUrl: string; FileType: string }
  References?: Reference[]
  Widget?: { WidgetId: string; WidgetRunId: string; State: string; EncodedWidget?: string; View?: string }
  CustomVariables?: { [key: string]: string }
  /** 反问澄清内容体（Type === 'questionnaire' 时有值） */
  Questionnaire?: Questionnaire
}

// ---------------------------------------------------------------------------
// 反问澄清（questionnaire）
// ---------------------------------------------------------------------------

export const QuestionnaireQuestionType = { Single: 1, Multiple: 2 } as const

export interface QuestionnaireOption {
  Label?: string
  Description?: string
  label?: string
  description?: string
}

export interface QuestionnaireQuestion {
  Index?: number
  Question?: string
  Type?: 1 | 2
  Required?: boolean
  Options?: QuestionnaireOption[]
  index?: number
  question?: string
  type?: 1 | 2
  required?: boolean
  options?: QuestionnaireOption[]
}

export interface QuestionnaireAnswer {
  Question?: string
  SelectedLabels?: string[]
  question?: string
  selected_labels?: string[]
  selectedLabels?: string[]
}

export interface Questionnaire {
  Title?: string
  Questions?: QuestionnaireQuestion[]
  Answers?: QuestionnaireAnswer[]
  title?: string
  questions?: QuestionnaireQuestion[]
  answers?: QuestionnaireAnswer[]
}

export interface NormalizedQuestionnaireOption {
  label: string
  description: string
}

export interface NormalizedQuestionnaireQuestion {
  id: number
  text: string
  type: 1 | 2
  required?: boolean
  options: NormalizedQuestionnaireOption[]
}

export interface NormalizedQuestionnaire {
  title: string
  questions: NormalizedQuestionnaireQuestion[]
  answers: QuestionnaireAnswer[]
}

export interface QuestionnaireSubmitItem {
  questionText: string
  isMulti: boolean
  selectedOption: string
  selectedOptions: string[]
}

export interface QuestionnaireDefaultAnswer {
  questionId: number
  selectedIndex?: number
  selectedIndices?: number[]
}

export interface QuestionnaireSummaryItem {
  question: string
  answerLabel: string
}

export interface Message {
  Type: MessageType
  MessageId: string
  Name: string
  Title: string
  Icon?: string
  Status: string
  StatusDesc?: string
  Contents?: Content[]
  ExtraInfo?: { Elapsed?: NumberLike; StartTime?: NumberLike; ToolName?: string; AgentName?: string }
}

export interface Procedure {
  ParentMessageId?: string
  Name: string
  Title: string
  Status: string
  Type: string
  Agent?: { Status: number; Reply?: string; Output?: string; ModelName?: string }
  Knowledge?: { Content: string }
  Workflow?: { WorkflowName: string; Content: string }
}

export interface Record {
  Role: RecordRole
  RecordId: string
  RelatedRecordId?: string
  ConversationId: string
  Status: string
  StatusDesc?: string
  Messages?: Message[]
  Procedures?: Procedure[]
  StatInfo?: { Elapsed?: NumberLike; TotalTokens?: NumberLike; ModelName?: string }
  ExtraInfo?: { RequestId?: string; TraceId?: string; Elapsed?: NumberLike; IsFromSelf?: boolean }
  Score?: number
}

export interface ErrorInfo {
  Code: number
  Message: string
  RequestId?: string
  TraceId?: string
}

export interface ConversationPayload {
  Id: string
  UserId: string
  ApplicationId?: string | null
  Title: string
  LastActiveAt: number
  CreatedAt: number
  IsNewConversation?: boolean
}

/** 服务 B 只注入 conversation / error 两个自有事件，其余均为上游透传 */
export interface ConversationEvent {
  Type: 'conversation'
  Payload: ConversationPayload
}
export interface RequestAckEvent {
  Type: 'request_ack'
  RequestAck: Record
  RecordId?: string
}
export interface ResponseEvent {
  Type: 'response.created' | 'response.processing' | 'response.completed'
  Response: Record
  RecordId?: string
}
export interface MessageAddedEvent {
  Type: 'message.added'
  Message: Message
  RecordId?: string
}
export interface MessageStateEvent {
  Type: 'message.processing' | 'message.done'
  MessageId: string
  Message: Message
  RecordId?: string
}
export interface ContentAddedEvent {
  Type: 'content.added'
  MessageId: string
  ContentIndex: number
  Content: Content
  RecordId?: string
}
export interface ReferenceAddedEvent {
  Type: 'reference.added'
  MessageId: string
  ContentIndex: number
  Reference: Reference
  RecordId?: string
}
export interface TextDeltaEvent {
  Type: 'text.delta'
  MessageId: string
  ContentIndex: number
  Text: string
  RecordId?: string
}
export interface ErrorEvent {
  Type: 'error'
  Error: ErrorInfo
  RecordId?: string
}
/** 保活事件：仅当后端 SSE_HEARTBEAT_MODE=event 时出现；前端一律忽略 */
export interface PingEvent {
  Type: 'ping'
}

export type SseEvent =
  | ConversationEvent
  | RequestAckEvent
  | ResponseEvent
  | MessageAddedEvent
  | MessageStateEvent
  | ContentAddedEvent
  | ReferenceAddedEvent
  | TextDeltaEvent
  | ErrorEvent
  | PingEvent
