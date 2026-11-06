#!/usr/bin/env bash
# codex giả cho test. Biến môi trường:
#   FAKE_CODEX_FAIL=1   thoát mã 1
#   FAKE_LOG=<file>     ghi tham số để test kiểm
set -u

if [ "${1:-}" = "--version" ]; then
  echo "codex-cli 0.166.0"
  exit 0
fi

[ -n "${FAKE_LOG:-}" ] && printf 'codex %s\n' "$*" >> "$FAKE_LOG"

out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
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
