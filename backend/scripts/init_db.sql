-- 服务 B 建表脚本（PostgreSQL）
-- 执行：psql "$DATABASE_URL" -f scripts/init_db.sql

CREATE TABLE IF NOT EXISTS "user" (
    user_id    VARCHAR(64) PRIMARY KEY,
    name       VARCHAR(128),
    status     VARCHAR(16) NOT NULL DEFAULT 'allowed',
    remark     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_conversation (
    id             VARCHAR(64) PRIMARY KEY,
    user_id        VARCHAR(64) NOT NULL,
    application_id VARCHAR(64),
    title          VARCHAR(256),
    last_active_at BIGINT NOT NULL,
    created_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_conversation_user
    ON chat_conversation (user_id, last_active_at DESC);

-- AgentId 缓存：Skills / 工具 / 连接器 / 知识库按钮需要一个可修改的 AgentId
CREATE TABLE IF NOT EXISTS agent_config (
    id             SERIAL PRIMARY KEY,
    user_id        VARCHAR(64) NOT NULL,
    application_id VARCHAR(64) NOT NULL,
    agent_id       VARCHAR(64) NOT NULL,
    CONSTRAINT uq_agent_user_app UNIQUE (user_id, application_id)
);

-- 分享快照
CREATE TABLE IF NOT EXISTS shared_conversation (
    id                     VARCHAR(64) PRIMARY KEY,
    user_id                VARCHAR(64) NOT NULL,
    application_id         VARCHAR(64),
    parent_conversation_id VARCHAR(64),
    title                  VARCHAR(256),
    records_json           TEXT NOT NULL DEFAULT '[]',
    created_at             BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_conversation_user
    ON shared_conversation (user_id, created_at DESC);
