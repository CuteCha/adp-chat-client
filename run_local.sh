#!/usr/bin/env bash
# adp-chat-client 本地一键脚本：Docker 部署 / 源码开发模式
#
# 用法：
#   ./run_local.sh up [--no-build]   构建并启动 postgres + backend + frontend
#   ./run_local.sh down              停止并清理容器（保留数据卷）
#   ./run_local.sh down -v          连数据卷一起删（会清库）
#   ./run_local.sh stop              仅停止容器
#   ./run_local.sh status            查看容器状态
#   ./run_local.sh logs [service]    跟随日志（默认 backend）
#   ./run_local.sh psql              进入数据库
#   ./run_local.sh init-db           执行 scripts/init_db.sql 建表
#   ./run_local.sh dev               源码模式（不打包镜像）：会自动拉起 postgres
#   ./run_local.sh dev-stop          停止源码模式的后端与前端进程
#
# 环境变量文件：
#   .env         POSTGRES_* / *_PORT（docker compose 读取）
#   backend/.env TC_SECRET_ID/KEY、APP_CONFIGS、SSE_* 等
# 首次使用：
#   cp .env.example .env && cp backend/.env.example backend/.env

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
RESET='\033[0m'

info() { echo -e "${GREEN}[info]${RESET} $*"; }
warn() { echo -e "${YELLOW}[warn]${RESET} $*"; }
err() { echo -e "${RED}[error]${RESET} $*" >&2; }

# ---------------------------------------------------------------- 基础工具

# 从 env 文件读一个 key，读不到用默认值（不因 grep 退出码中断）
env_val() {
    local key="$1" file="$2" fallback="${3:-}" v
    v="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
    v="${v%$'\r'}"
    printf '%s' "${v:-$fallback}"
}

ROOT_ENV=.env
FRONTEND_PORT="$(env_val FRONTEND_PORT "$ROOT_ENV" 8080)"
BACKEND_PORT="$(env_val BACKEND_HOST_PORT "$ROOT_ENV" 8200)"
DEV_BACKEND_PORT=8100
DEV_FRONTEND_PORT=5273

compose() {
    if docker compose version >/dev/null 2>&1; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
}

require_docker() {
    command -v docker >/dev/null 2>&1 || { err "未找到 docker，请先安装 Docker Desktop"; exit 1; }
    docker info >/dev/null 2>&1 || { err "docker 守护进程不可用，请先启动 Docker"; exit 1; }
}

require_env() {
    [ -f backend/.env ] || {
        err "缺少 backend/.env"
        err "先执行：cp backend/.env.example backend/.env 并填写 TC_SECRET_ID/KEY、APP_CONFIGS"
        exit 1
    }
    [ -f "$ROOT_ENV" ] || warn "未发现根目录 .env，使用 docker-compose 默认值（可 cp .env.example .env）"
}

# 轮询 URL 直到 200，超时返回 1
wait_url() {
    local url="$1" timeout="${2:-60}" i=0
    while [ "$i" -lt "$timeout" ]; do
        if curl -fs -o /dev/null "$url" 2>/dev/null; then return 0; fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

psql_exec() {
    # 有 TTY 时保持交互体验，无 TTY（脚本/CI）加 -T
    if [ -t 0 ]; then
        compose exec postgres psql -U "$PG_USER" -d "$PG_DB"
    else
        compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB"
    fi
}

PG_USER="$(env_val POSTGRES_USER "$ROOT_ENV" postgres)"
PG_DB="$(env_val POSTGRES_DB "$ROOT_ENV" adp_chat_b)"

# ---------------------------------------------------------------- 命令

cmd_up() {
    require_docker
    require_env

    if [ "${1:-}" = "--no-build" ]; then
        info "启动（跳过构建）…"
        compose up -d
    else
        info "构建并启动…"
        compose up -d --build
    fi

    info "等待 backend 就绪…"
    if wait_url "http://localhost:${BACKEND_PORT}/health" 90; then
        info "backend 已就绪"
    else
        err "backend 未在 90s 内就绪，查看日志：./run_local.sh logs backend"
        exit 1
    fi

    cmd_init_db

    printf '%b\n' "
${GREEN}部署完成${RESET}
  前端      http://localhost:${FRONTEND_PORT}
  后端 API  http://localhost:${BACKEND_PORT}/docs
  数据库    localhost:$(env_val POSTGRES_HOST_PORT "$ROOT_ENV" 5432) (${PG_DB})

  插入白名单用户（服务 B 不提供管理接口）：
    ./run_local.sh psql backend/scripts/user.sql
"
}

cmd_down() {
    require_docker
    if [ "${1:-}" = "-v" ]; then
        warn "将删除数据卷（库会被清空）"
        compose down -v
    else
        compose down
    fi
    info "已停止并清理容器"
}

cmd_stop() { require_docker; compose stop; info "容器已停止"; }
cmd_status() { require_docker; compose ps; }
cmd_logs() { require_docker; compose logs -f "${1:-backend}"; }

cmd_psql() {
    require_docker
    if [ -n "${1:-}" ] && [ -r "${1:-}" ]; then
        compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" < "$1"
    else
        psql_exec
    fi
}

cmd_init_db() {
    require_docker
    local cid
    cid="$(compose ps -q postgres 2>/dev/null || true)"
    [ -n "$cid" ] || { err "postgres 容器未运行，先执行 ./run_local.sh up"; exit 1; }
    info "建表 backend/scripts/init_db.sql → ${PG_DB}"
    compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" < backend/scripts/init_db.sql
    info "建表完成（幂等，可重复执行）"
}

# 选一个可用且装了依赖的 python
resolve_python() {
    if [ -n "${PYTHON:-}" ]; then printf '%s' "$PYTHON"; return; fi
    local c
    for c in python3 python; do
        if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import fastapi, uvicorn, asyncpg' >/dev/null 2>&1; then
            printf '%s' "$c"
            return
        fi
    done
    printf '%s' "python3"
}

cmd_dev() {
    require_env

    # 数据库：优先用 compose 里的 postgres（源码模式同样连 localhost:5432）
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        info "启动 postgres 容器…"
        compose up -d postgres
    else
        warn "未检测到 docker，假定本机已有 postgres 且可连 localhost:5432/${PG_DB}"
    fi

    PY="$(resolve_python)"
    if ! "$PY" -c 'import fastapi, uvicorn, asyncpg' >/dev/null 2>&1; then
        err "当前 python（${PY}）缺少依赖，请先安装：cd backend && pip install -e ."
        err "或指定解释器：PYTHON=/path/to/python ./run_local.sh dev"
        exit 1
    fi

    info "源模式启动后端 127.0.0.1:${DEV_BACKEND_PORT}（${PY}）"
    (cd backend && nohup "$PY" -m uvicorn app.main:app --host 127.0.0.1 --port "$DEV_BACKEND_PORT" \
        > /tmp/adp_backend.log 2>&1 & echo $! > "$ROOT_DIR/.backend.pid")

    if ! wait_url "http://127.0.0.1:${DEV_BACKEND_PORT}/health" 30; then
        err "后端启动失败，日志：/tmp/adp_backend.log"
        tail -20 /tmp/adp_backend.log >&2 || true
        exit 1
    fi
    info "后端已就绪"

    if [ ! -d frontend/node_modules ]; then
        info "安装前端依赖…"
        (cd frontend && npm install --no-audit --no-fund)
    fi

    info "源模式启动前端 http://localhost:${DEV_FRONTEND_PORT}"
    (cd frontend && nohup npx vite --port "$DEV_FRONTEND_PORT" \
        > /tmp/adp_frontend.log 2>&1 & echo $! > "$ROOT_DIR/.frontend.pid")

    if ! wait_url "http://localhost:${DEV_FRONTEND_PORT}/" 30; then
        err "前端启动失败，日志：/tmp/adp_frontend.log"
        exit 1
    fi

    cat <<EOF

${GREEN}开发模式已启动${RESET}
  前端  http://localhost:${DEV_FRONTEND_PORT}   (vite 已代理 /api → ${DEV_BACKEND_PORT})
  后端  http://127.0.0.1:${DEV_BACKEND_PORT}/docs
  停止  ./run_local.sh dev-stop
EOF
}

cmd_dev_stop() {
    local stopped=0
    for f in .backend.pid .frontend.pid; do
        if [ -f "$f" ]; then
            pid="$(cat "$f")"
            if kill "$pid" 2>/dev/null; then stopped=1; fi
            rm -f "$f"
        fi
    done
    # 兜底：按进程名清理
    pkill -f "uvicorn app.main:app --host 127.0.0.1 --port ${DEV_BACKEND_PORT}" 2>/dev/null || true
    pkill -f "vite --port ${DEV_FRONTEND_PORT}" 2>/dev/null || true
    if [ "$stopped" = 1 ]; then info "已停止开发模式进程"; else info "未发现运行中的开发进程"; fi
}

usage() {
    cat <<'EOF'
用法: ./run_local.sh <command> [args]

  up [--no-build]   构建并启动 postgres + backend + frontend（完成后自动建表）（完成后自动建表）
  down [-v]         停止并清理容器（-v 同时删除数据卷）
  stop              停止容器
  status            查看容器状态
  logs [service]    跟随日志（backend / frontend / postgres）
  psql [file.sql]   进入数据库，或执行一个 sql 文件
  init-db           建表（幂等）
  dev               源码模式：拉起 postgres，后端 8100 + 前端 5273
  dev-stop          停止源码模式进程
EOF
}

case "${1:-}" in
    up) cmd_up "${2:-}" ;;
    down) cmd_down "${2:-}" ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    logs) cmd_logs "${2:-backend}" ;;
    psql) cmd_psql "${2:-}" ;;
    init-db) cmd_init_db ;;
    dev) cmd_dev ;;
    dev-stop) cmd_dev_stop ;;
    "" | -h | --help | help) usage ;;
    *) err "未知命令: $1"; usage; exit 1 ;;
esac
