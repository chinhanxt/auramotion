#!/usr/bin/env bash
# Chạy nền từng dịch vụ AuraMotion (bản build sẵn), tiện khi phát triển trên 1 máy.
# Dùng: bash scripts/svc.sh start|stop|restart|status [app|worker|muse|all]   (mặc định all)
# app = next start (PORT trong .env), worker = npm run worker, muse = scripts/muse2api.sh
# Log: data/logs/{app,worker}.log · pid: data/{app,worker}.pid
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p data/logs
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"; PORT="${PORT:-3000}"

pid_of() { [ -f "data/$1.pid" ] && cat "data/$1.pid"; }
alive() { local p; p="$(pid_of "$1" || true)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

stop_one() {
  local name="$1" p
  p="$(pid_of "$name" || true)"
  if [ -n "$p" ]; then
    kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
    for _ in $(seq 1 30); do kill -0 -- "-$p" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$p" 2>/dev/null || true
  fi
  rm -f "data/$name.pid"
  # next-server còn giữ cổng (vd chạy tay trước đó)
  if [ "$name" = app ]; then
    for q in $(ss -ltnp 2>/dev/null | awk -v port=":$PORT" '$4 ~ port"$"' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$q" 2>/dev/null || true; done
  fi
  echo "$name: đã dừng"
}

start_one() {
  local name="$1"
  if alive "$name"; then echo "$name: đang chạy (pid $(pid_of "$name"))"; return; fi
  case "$name" in
    app) setsid npm start >> data/logs/app.log 2>&1 < /dev/null & ;;
    worker) setsid npm run -s worker >> data/logs/worker.log 2>&1 < /dev/null & ;;
  esac
  echo $! > "data/$name.pid"
  if [ "$name" = app ]; then
    for _ in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
  else
    sleep 3
  fi
  if alive "$name"; then echo "$name: chạy (pid $(pid_of "$name"))"; else echo "$name: KHÔNG lên, xem data/logs/$name.log" >&2; return 1; fi
}

act="${1:-status}"; target="${2:-all}"
names=(); case "$target" in all) names=(muse app worker) ;; *) names=("$target") ;; esac
for n in "${names[@]}"; do
  if [ "$n" = muse ]; then bash scripts/muse2api.sh "$act"; continue; fi
  case "$act" in
    start) start_one "$n" ;;
    stop) stop_one "$n" ;;
    restart) stop_one "$n"; start_one "$n" ;;
    status) if alive "$n"; then echo "$n: chạy (pid $(pid_of "$n"))"; else echo "$n: không chạy"; fi ;;
    *) echo "dùng: $0 start|stop|restart|status [app|worker|muse|all]" >&2; exit 2 ;;
  esac
done
