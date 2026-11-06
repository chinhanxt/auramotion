#!/usr/bin/env bash
# Chạy toàn bộ AuraMotion trên 1 máy: Postgres + Redis (docker compose), muse2api, migrate, app, worker.
#
# Dùng:   bash scripts/start-all.sh        (Ctrl+C dừng hết)
#
# Đọc cấu hình từ .env ở thư mục gốc repo. Biến đã có sẵn trong môi trường được giữ nguyên (không bị .env ghi đè).
#   PORT               cổng app, mặc định 3000
#   MUSE_API_URL       địa chỉ muse2api, cổng muse2api lấy từ đây (mặc định http://127.0.0.1:18610)
#   MUSE_API_KEY       key gọi muse2api (truyền cho muse2api làm MUSE2API_API_KEY)
#   MUSE2API_DIR       bắt buộc, thư mục repo muse2api đã tạo .venv
#   MUSE2API_DRIVER    mock | browser, mặc định browser
#   MUSE2API_DATA_DIR  dữ liệu muse2api (tài khoản, media), mặc định ./data/muse2api
#   MUSE2API_ADMIN_KEY admin key muse2api (dashboard, muse-keepalive.sh), bỏ trống thì dùng MUSE_API_KEY
#   SKIP_DOCKER=1      không chạy docker compose (Postgres/Redis đã chạy sẵn)
#   SKIP_BUILD=1       không chạy npm run build (dùng bản build có sẵn trong .next)
# Log: data/logs/{muse2api,app,worker}.log
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

die() { echo "LỖI: $*" >&2; exit 1; }

[ -f .env ] || die "thiếu file .env. Tạo bằng: cp .env.example .env rồi điền giá trị (xem README.md)."

# Nạp .env: KEY=VALUE, bỏ dòng trống/comment, bỏ nháy bao ngoài, không ghi đè biến đã có.
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  key="${BASH_REMATCH[2]}" val="${BASH_REMATCH[3]}"
  if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
  [ -n "${!key+x}" ] || export "$key=$val"
done < .env

[ -n "${MUSE2API_DIR:-}" ] || die "thiếu MUSE2API_DIR trong .env (thư mục repo muse2api, xem README.md mục muse2api)."
[ -x "$MUSE2API_DIR/.venv/bin/python" ] || die "không thấy $MUSE2API_DIR/.venv/bin/python. Cài muse2api: cd $MUSE2API_DIR && python3 -m venv .venv && .venv/bin/pip install -e ."

PORT="${PORT:-3000}"
MUSE_API_URL="${MUSE_API_URL:-http://127.0.0.1:18610}"
hostport="${MUSE_API_URL#*://}"; hostport="${hostport%%/*}"
MUSE_HOST="${hostport%%:*}"
MUSE_PORT="${hostport##*:}"
[ "$MUSE_PORT" != "$hostport" ] || die "MUSE_API_URL phải có cổng, vd http://127.0.0.1:18610"
[ "$MUSE_HOST" != "localhost" ] || MUSE_HOST=127.0.0.1

LOG_DIR="$ROOT/data/logs"
mkdir -p "$LOG_DIR"
MUSE_DATA="$(mkdir -p "${MUSE2API_DATA_DIR:-./data/muse2api}" && cd "${MUSE2API_DATA_DIR:-./data/muse2api}" && pwd)"

PIDS=()
cleanup() {
  trap - EXIT INT TERM
  [ ${#PIDS[@]} -eq 0 ] && return
  echo "Đang dừng..."
  for pid in "${PIDS[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  for _ in $(seq 1 20); do
    alive=0
    for pid in "${PIDS[@]}"; do kill -0 -- "-$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.5
  done
  for pid in "${PIDS[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  echo "Đã dừng hết."
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Chạy lệnh nền trong process group riêng để dừng được cả tiến trình con (npm → next, tsx → node).
run_bg() {
  local name="$1"; shift
  echo "[$name] log: $LOG_DIR/$name.log"
  setsid "$@" >> "$LOG_DIR/$name.log" 2>&1 < /dev/null &
  PIDS+=("$!")
}

wait_http() {
  local name="$1" url="$2" tries="$3"
  for _ in $(seq 1 "$tries"); do
    curl -fsS -m 2 -o /dev/null "$url" 2>/dev/null && return 0
    sleep 1
  done
  die "$name không lên sau ${tries}s, xem $LOG_DIR/$name.log"
}

if [ "${SKIP_DOCKER:-}" != 1 ]; then
  echo "[docker] Postgres + Redis"
  docker compose up -d --wait
fi

echo "[muse2api] driver=${MUSE2API_DRIVER:-browser} $MUSE_HOST:$MUSE_PORT, dữ liệu $MUSE_DATA"
# Chạy trong thư mục dữ liệu để muse2api không đọc .env trong repo của nó; cấu hình truyền qua biến môi trường.
(
  cd "$MUSE_DATA"
  export MUSE2API_DRIVER="${MUSE2API_DRIVER:-browser}" MUSE2API_HOST="$MUSE_HOST" MUSE2API_PORT="$MUSE_PORT" \
    MUSE2API_DATA_DIR="$MUSE_DATA" MUSE2API_API_KEY="${MUSE_API_KEY:-}" MUSE2API_ADMIN_KEY="${MUSE2API_ADMIN_KEY:-}"
  exec setsid "$MUSE2API_DIR/.venv/bin/python" -m muse2api >> "$LOG_DIR/muse2api.log" 2>&1 < /dev/null
) &
PIDS+=("$!")
wait_http muse2api "http://$MUSE_HOST:$MUSE_PORT/healthz" 60

echo "[db] prisma migrate deploy"
npx prisma migrate deploy

if [ "${SKIP_BUILD:-}" != 1 ]; then
  echo "[build] npm run build (log: $LOG_DIR/build.log)"
  npm run build > "$LOG_DIR/build.log" 2>&1 || die "build lỗi, xem $LOG_DIR/build.log"
fi

run_bg app npm start -- -p "$PORT"
run_bg worker npm run worker
wait_http app "http://127.0.0.1:$PORT/" 60

echo
echo "AuraMotion: http://localhost:$PORT  ·  muse2api dashboard: http://$MUSE_HOST:$MUSE_PORT/dashboard"
echo "Ctrl+C để dừng hết."

# Một tiến trình chết thì dừng cả cụm.
wait -n "${PIDS[@]}" || true
echo "Có tiến trình đã thoát, xem log trong $LOG_DIR" >&2
exit 1
