-- 白名单维护脚本（服务 B 不提供管理接口，直接改库）
-- 执行：psql "$DATABASE_URL" -f scripts/user.sql

-- 新增白名单用户
INSERT INTO "user" (user_id, name, status, remark)
VALUES ('u1', '示例用户', 'allowed', '调试用')
ON CONFLICT (user_id) DO NOTHING;

-- 停用某个用户（A 系统前端将不再显示入口按钮）
-- UPDATE "user" SET status = 'blocked' WHERE user_id = 'u1';

-- 查询白名单
-- SELECT user_id, name, status FROM "user" ORDER BY created_at;
