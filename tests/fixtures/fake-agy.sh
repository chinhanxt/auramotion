#!/usr/bin/env bash
# agy giả cho test. Biến môi trường:
#   FAKE_SLEEP=<giây>   chạy kèm 1 tiến trình con + 1 tiến trình cháu cùng `sleep`, ghi pid vào FAKE_PIDS
#   FAKE_FAIL=1         thoát mã 1
#   FAKE_RESPONSE=<chuỗi JSON>  giá trị trường response (mặc định "{\"prompt\":\"fake prompt\"}")
#   FAKE_LOG=<file>     ghi tham số và quyền file token để test kiểm
set -u

if [ "${1:-}" = "--version" ]; then
  echo "1.5.2"
  exit 0
fi

gemini_dir="" agent="" prompt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --gemini_dir) gemini_dir="$2"; shift 2 ;;
    --agent) agent="$2"; shift 2 ;;
    -p) prompt="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -n "${FAKE_LOG:-}" ]; then
  {
    echo "cwd=$PWD"
    echo "gemini_dir=$gemini_dir"
    echo "agent=$agent"
    echo "agent_file=$([ -f ".agents/agents/$agent.md" ] && echo yes || echo no)"
    echo "token_mode=$(stat -c %a "$gemini_dir/antigravity-cli/antigravity-oauth-token" 2>/dev/null || echo missing)"
    echo "prompt=$prompt"
  } >> "$FAKE_LOG"
fi

if [ -n "${FAKE_SLEEP:-}" ]; then
  ( sleep "$FAKE_SLEEP" & echo $! >> "$FAKE_PIDS"; wait ) &
  echo $! >> "$FAKE_PIDS"
  sleep "$FAKE_SLEEP"
fi

if [ -n "${FAKE_FAIL:-}" ]; then
  echo "agy: fake failure" >&2
  exit 1
fi

echo "Loading..."
default_response='"{\"prompt\":\"fake prompt\"}"'
printf '{"status":"SUCCESS","response":%s}\n' "${FAKE_RESPONSE:-$default_response}"
