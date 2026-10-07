# adp-chat-client（重构版）

面向 **服务 B** 定位的重构版本：一个 Thin Gateway —— 对话走 SSE 透传给腾讯云 ADP，历史消息/文件/能力配置按需转发，**不做登录体系，不做定时任务，不做远程终端**。

原 `server/` + `client/` 全部位于 `a-debug/backup/`，仅供对照；根目录只保留重构后的代码。

```
adp-chat-client/
├── backend/     FastAPI（SSE 透传 + 腾讯云 API 转发）→ Docker 镜像 B
├── frontend/    Vue3 调试台（Vite）                    → nginx 静态镜像
├── docker-compose.yml  backend + frontend + postgres
├── run_local.sh        一键部署 / 源码启动
└── a-debug/backup/     重构前的原始代码（只读参考）
```

## 一、能力清单

| 分组 | 端点 |
|---|---|
| 健康 | `GET /health` |
| 白名单 | `GET /users/{user_id}/allowed`（免鉴权，给系统 A 判断按钮显隐） |
| 对话 | `POST /chat/message`（SSE）、`GET /chat/messages`（云端历史，V2） |
| 会话 | `GET/POST/DELETE /conversations`、`PATCH /conversations/{id}`、`GET /chat/conversations` |
| 应用 | `GET /application/list` |
| Agent | `POST /agent/copy`（幂等 CopyAgentFromApp）、`GET/DELETE /agent/config` |
| 通用转发 | `POST /adp/{action}`（Skills / 工具 / 连接器 / 知识库的所有增删改） |
| 文件 | `POST /file/upload`、`POST /file/parse`（docParse SSE）、`GET /file/download`、`GET /file/list_dir` |
| 分享 | `POST /share/create`、`GET /share/{id}` |
| 反馈 | `POST /feedback/rate`（Like=1 / Dislike=2） |
| 引用 | `POST /reference/detail`（DescribeRefer） |
| 推荐语 | `GET /suggestions` |

统一请求头：`X-User-Id: <user_id>`，必须是 `user` 表内 `status='allowed'` 的用户，否则 403。

## 二、SSE 的两个关键机制

1. **心跳保活**：距上次发出任意字节超过 `SSE_HEARTBEAT_INTERVAL`（默认 15s）就发一帧 `: ping`（注释帧，标准 SSE 客户端自动忽略；也可配 `SSE_HEARTBEAT_MODE=event` 发 `data:` 帧）。系统 A 的网关不会因空闲断开。
2. **上游空闲超时**：`SSE_IDLE_TIMEOUT`（默认 5400s）内没有任何上游数据才判定上游真死，此时下发 `error`（Code=504）再关流 —— 不会静默结束。

响应头统一带 `Cache-Control: no-cache` + `X-Accel-Buffering: no`（nginx 配置同向设置已在 `frontend/nginx.conf`），**不要挂 GZip 中间件**，否则流式会被缓冲。

客户端断开时 `app/upstream.py` 会 `transport.abort()` 立即释放上游 TCP。

## 三、数据库（PostgreSQL）

| 表 | 用途 |
|---|---|
| `user` | 白名单（靠 SQL 脚本维护，不提供管理接口） |
| `chat_conversation` | 会话元信息（消息本体在腾讯云） |
| `agent_config` | `UserId + ApplicationId → AgentId` 缓存 |
| `shared_conversation` | 分享快照 |

建表：`backend/scripts/init_db.sql`；白名单示例：`backend/scripts/user.sql`。

## 四、本地启动

```bash
cp .env.example .env                      # POSTGRES_* / *_PORT
cp backend/.env.example backend/.env      # 填 ADP 密钥 / APP_CONFIGS
./run_local.sh up                         # 构建并启动 postgres + backend + frontend
                                          # 就绪后自动执行 init_db.sql 建表
./run_local.sh psql backend/scripts/user.sql   # 插入白名单用户（u1）
```

| 模式 | 前端 | 后端 |
|---|---|---|
| Docker（`up`） | http://localhost:8080（nginx 反代 `/api`） | http://localhost:8200/docs |
| 源码（`dev`） | http://localhost:5273（Vite proxy `/api` → 8100） | http://127.0.0.1:8100/docs |

两处端口均可在根目录 `.env` 调整：`FRONTEND_PORT` / `BACKEND_HOST_PORT`（默认 8200，因为宿主 8000 常被占用）。

其它命令：`down [-v]`、`stop`、`status`、`logs [service]`、`psql [file.sql]`、`init-db`、`dev-stop`。

说明：
- 后端镜像 pip 默认走清华源（`Dockerfile` 的 `ARG PIP_INDEX_URL`），可用 `--build-arg PIP_INDEX_URL=...` 覆盖
- 前端镜像使用本机常见的 `node:22-bullseye-slim` / `nginx:alpine` 标签，避免重新拉取
- 源码模式的解释器由 `PYTHON` 指定（需已装好 `backend` 依赖），缺省用 `python3`

## 五、环境变量（backend/.env）

```
TC_SECRET_ID / TC_SECRET_KEY          V3 签名（管理类接口）
APP_CONFIGS=[{"ApplicationId":"","AppKey":"","Name":""}]
SERVICE_VENDOR=ChinaTencentCloud
DATABASE_URL=postgresql+asyncpg://...  （或 PGSQL_HOST/PORT/DB/USER/PASSWORD）
SSE_IDLE_TIMEOUT=5400
SSE_HEARTBEAT_INTERVAL=15
SSE_HEARTBEAT_MODE=comment
SUGGESTION_CONFIGS=[...]               可选，快捷提问
CORS_ORIGINS=*
```

## 六、调试台（frontend）

- 会话侧栏 + 流式渲染：`reply`（Markdown + KaTeX + 代码高亮）、`thought` 折叠、`tool_call`、`task_execution`
- **反问澄清卡片**：`questionnaire` 类型的 content 渲染成可交互题目，提交 / 跳过会发起新一轮 SSE
- 四个能力按钮：`Skills / 工具 / 连接器 / 知识库`（`AgentPanel.vue`，全部走 `/adp/{action}`）
- 附件上传（图片直接上行，文档先 `docParse` 取 doc_id）、点赞点踩、引用详情、分享只读页（`?share=<id>`）

## 七、相对原项目删除的部分

登录/OAuth/账号体系、定时任务、远程终端、渠道配置、语音输入（ASR）、`vendor` 抽象层与 `openai_compatible`、`adp-widget` 打包产物、分享页之外的多余 UI 框架适配（TDesign 已移除）。
