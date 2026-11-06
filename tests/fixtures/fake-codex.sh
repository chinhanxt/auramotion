#!/usr/bin/env bash
# codex giả cho test. Biến môi trường:
#   FAKE_CODEX_FAIL=1   thoát mã 1
#   FAKE_LOG=<file>     ghi tham số (và stdin ở chế độ ảnh) để test kiểm
#   FAKE_QUOTA=1        chế độ ảnh: báo hết lượt, không có ảnh, thoát mã 1
# Chế độ ảnh (có --json): in sự kiện JSON, ghi ảnh vào $CODEX_HOME/generated_images/t123/ và file rollout.
set -u

if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.166.0"
  exit 0
fi

[ -n "${FAKE_LOG:-}" ] && printf 'codex %s\n' "$*" >> "$FAKE_LOG"

out=""
json=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    --json) json=1; shift ;;
    *) shift ;;
  esac
done

if [ -n "${FAKE_CODEX_FAIL:-}" ]; then
  echo "codex: fake failure" >&2
  exit 1
fi

if [ -n "$out" ]; then
  printf '%s' '{"lines":["Câu 1.","Câu 2."]}' > "$out"
fi
[ -z "$json" ] && exit 0

prompt="$(cat)"
[ -n "${FAKE_LOG:-}" ] && printf 'stdin %s\n' "$prompt" >> "$FAKE_LOG"

thread="t123"
home="${CODEX_HOME:?}"
mkdir -p "$home/sessions/2026/11/06"
echo '{"type":"session_meta"}' > "$home/sessions/2026/11/06/rollout-x-$thread.jsonl"
echo "{\"type\":\"thread.started\",\"thread_id\":\"$thread\"}"

if [ -n "${FAKE_QUOTA:-}" ]; then
  echo '{"type":"error","message":"You'"'"'ve hit your usage limit"}'
  echo '{"type":"turn.failed","error":{"message":"You'"'"'ve hit your usage limit"}}'
  exit 1
fi

here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$home/generated_images/$thread"
cp "$here/sample.png" "$home/generated_images/$thread/img.png"
echo '{"type":"item.completed","item":{"type":"agent_message","text":"done"}}'
echo '{"type":"turn.completed"}'
