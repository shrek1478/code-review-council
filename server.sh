#!/usr/bin/env bash
# server.sh — 控制 Code Review Council 前後端服務

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_LOG="$SCRIPT_DIR/logs/api.log"
WEB_LOG="$SCRIPT_DIR/logs/web.log"
PID_DIR="$SCRIPT_DIR/logs"
API_PID_FILE="$PID_DIR/api.pid"
WEB_PID_FILE="$PID_DIR/web.pid"
API_MAIN="$SCRIPT_DIR/dist/apps/api/src/main.js"
API_PORT="${API_PORT:-3100}"
WEB_PORT="${WEB_PORT:-4200}"

mkdir -p "$PID_DIR"

# ── 顏色輸出 ──────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── 輔助函式 ──────────────────────────────────────────────────
is_running() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

stop_service() {
  local name="$1" pid_file="$2"
  if is_running "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    info "Stopping $name (PID $pid)..."
    kill "$pid" 2>/dev/null || true
    # 等最多 5 秒讓 process 結束
    for _ in {1..10}; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    # 還活著就強制 kill
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    rm -f "$pid_file"
    info "$name stopped."
  else
    warn "$name is not running."
    rm -f "$pid_file"
  fi
}

# ── 指令：start ───────────────────────────────────────────────
cmd_start() {
  # 檢查 dist 是否存在
  if [[ ! -f "$API_MAIN" ]]; then
    error "API build not found at $API_MAIN"
    error "Please run: npm run build"
    exit 1
  fi

  # 啟動 API
  if is_running "$API_PID_FILE"; then
    warn "API is already running (PID $(cat "$API_PID_FILE"))."
  else
    info "Starting API on port $API_PORT..."
    node "$API_MAIN" >> "$API_LOG" 2>&1 &
    echo $! > "$API_PID_FILE"
    info "API started (PID $(cat "$API_PID_FILE")), log: $API_LOG"
  fi

  # 啟動 Web
  if is_running "$WEB_PID_FILE"; then
    warn "Web is already running (PID $(cat "$WEB_PID_FILE"))."
  else
    info "Starting Web on port $WEB_PORT..."
    npx nx serve web --port "$WEB_PORT" >> "$WEB_LOG" 2>&1 &
    echo $! > "$WEB_PID_FILE"
    info "Web started (PID $(cat "$WEB_PID_FILE")), log: $WEB_LOG"
  fi

  echo ""
  info "Services started:"
  info "  API → http://localhost:$API_PORT"
  info "  Web → http://localhost:$WEB_PORT"
  info "Use './server.sh logs' to tail logs, './server.sh stop' to stop."
}

# ── 指令：stop ────────────────────────────────────────────────
cmd_stop() {
  stop_service "Web" "$WEB_PID_FILE"
  stop_service "API" "$API_PID_FILE"

  # 也清掉殘留的 port
  lsof -ti:"$API_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
  lsof -ti:"$WEB_PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
}

# ── 指令：restart ─────────────────────────────────────────────
cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

# ── 指令：status ──────────────────────────────────────────────
cmd_status() {
  echo ""
  if is_running "$API_PID_FILE"; then
    echo -e "  API  ${GREEN}● running${NC} (PID $(cat "$API_PID_FILE")) — http://localhost:$API_PORT"
  else
    echo -e "  API  ${RED}○ stopped${NC}"
  fi

  if is_running "$WEB_PID_FILE"; then
    echo -e "  Web  ${GREEN}● running${NC} (PID $(cat "$WEB_PID_FILE")) — http://localhost:$WEB_PORT"
  else
    echo -e "  Web  ${RED}○ stopped${NC}"
  fi
  echo ""
}

# ── 指令：logs ────────────────────────────────────────────────
cmd_logs() {
  local target="${1:-all}"
  case "$target" in
    api) tail -f "$API_LOG" ;;
    web) tail -f "$WEB_LOG" ;;
    *)   tail -f "$API_LOG" "$WEB_LOG" ;;
  esac
}

# ── 指令：build-start ─────────────────────────────────────────
cmd_build_start() {
  info "Building API..."
  npx nest build
  info "Build complete."
  cmd_start
}

# ── 主程式 ────────────────────────────────────────────────────
case "${1:-help}" in
  start)        cmd_start ;;
  stop)         cmd_stop ;;
  restart)      cmd_restart ;;
  status)       cmd_status ;;
  logs)         cmd_logs "${2:-all}" ;;
  build-start)  cmd_build_start ;;
  help|--help|-h)
    echo ""
    echo "Usage: ./server.sh <command> [options]"
    echo ""
    echo "Commands:"
    echo "  start        啟動前後端服務"
    echo "  stop         停止前後端服務"
    echo "  restart      重啟前後端服務"
    echo "  status       查看服務狀態"
    echo "  logs [api|web|all]  追蹤 log（預設 all）"
    echo "  build-start  build API 後啟動所有服務"
    echo ""
    echo "Env:"
    echo "  API_PORT  API 埠號（預設 3100）"
    echo "  WEB_PORT  Web 埠號（預設 4200）"
    echo ""
    ;;
  *)
    error "Unknown command: $1"
    echo "Run './server.sh help' for usage."
    exit 1
    ;;
esac
