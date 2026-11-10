#!/usr/bin/env bash
# Chạy muse2api riêng của AuraMotion ở nền (không cần start-all.sh).
# Dùng: bash scripts/muse2api.sh start|stop|restart|status
# Đọc .env (MUSE2API_DIR, MUSE_API_URL, MUSE_API_KEY, MUSE2API_*). Log: data/logs/muse2api.log, pid: data/muse2api.pid
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
[ -f .env ] || { echo "thiếu .env" >&2; exit 1; }
set -a; source <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' .env); set +a

URL="${MUSE_API_URL:-http://127.0.0.1:18610}"
hostport="${URL#*://}"; hostport="${hostport%%/*}"
export MUSE2API_HOST="${hostport%%:*}" MUSE2API_PORT="${hostport##*:}" MUSE2API_API_KEY="${MUSE_API_KEY:-}"
[ "$MUSE2API_HOST" != localhost ] || MUSE2API_HOST=127.0.0.1
export MUSE2API_DATA_DIR="${MUSE2API_DATA_DIR:-$ROOT/data/muse2api}"
PID_FILE="$ROOT/data/muse2api.pid"
mkdir -p "$ROOT/data/logs" "$MUSE2API_DATA_DIR"

running() { [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; }

stop() {
  if running; then
    local pid; pid="$(cat "$PID_FILE")"
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid"
    for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  # Chrome headless còn sót của đúng cổng CDP này
  local cdp="${MUSE2API_CDP_PORT:-19210}"
  for p in $(pgrep -f "remote-debugging-port=${cdp}( |$)" || true); do kill "$p" 2>/dev/null || true; done
  echo "muse2api đã dừng"
}

start() {
  if running; then echo "muse2api đang chạy (pid $(cat "$PID_FILE"))"; return; fi
  [ -x "${MUSE2API_DIR:-}/.venv/bin/python" ] || { echo "MUSE2API_DIR chưa đúng" >&2; exit 1; }
  setsid "$MUSE2API_DIR/.venv/bin/python" -m muse2api >> "$ROOT/data/logs/muse2api.log" 2>&1 < /dev/null &
  echo $! > "$PID_FILE"
  for _ in $(seq 1 60); do
    curl -sf "http://$MUSE2API_HOST:$MUSE2API_PORT/healthz" >/dev/null && { echo "muse2api chạy ở $MUSE2API_HOST:$MUSE2API_PORT (pid $(cat "$PID_FILE"))"; return; }
    sleep 1
  done
  echo "muse2api không lên, xem data/logs/muse2api.log" >&2; exit 1
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) if running; then echo "đang chạy (pid $(cat "$PID_FILE"))"; else echo "không chạy"; fi ;;
  *) echo "dùng: $0 start|stop|restart|status" >&2; exit 2 ;;
esac
