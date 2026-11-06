#!/usr/bin/env bash
# vieneu-say giả cho test. Biến môi trường:
#   FAKE_LOG=<file>     ghi tham số mỗi lần chạy để test kiểm
#   FAKE_SLEEP=<giây>   chờ trước khi ghi file
#   FAKE_FAIL=1         thoát mã 1
set -u

[ -n "${FAKE_LOG:-}" ] && printf 'vieneu-say %s\n' "$*" >> "$FAKE_LOG"

list="" out="" file="" segments="" text=""
while [ $# -gt 0 ]; do
  case "$1" in
    --list) list=1; shift ;;
    -o|--output) out="$2"; shift 2 ;;
    -f|--file) file="$2"; shift 2 ;;
    --segments) segments="$2"; shift 2 ;;
    --voice|--ref|--device) shift 2 ;;
    --) text="${2:-}"; shift $# ;;
    *) text="$1"; shift ;;
  esac
done

if [ -n "$list" ]; then
  echo "⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên"
  echo "⭐ Quang Sơn — Nam · Trung · Phong cách tự nhiên"
  echo "Thục Đoan — Nữ · Nam · Phong cách kể chuyện"
  exit 0
fi

if [ -n "${FAKE_FAIL:-}" ]; then
  echo "vieneu-say: fake failure" >&2
  exit 1
fi

[ -n "${FAKE_SLEEP:-}" ] && sleep "$FAKE_SLEEP"

[ -n "$file" ] && text="$(cat "$file")"
if [ -z "$text" ] || [ -z "$out" ]; then
  echo "vieneu-say: cần chữ (text hoặc -f) và -o" >&2
  exit 2
fi

# Mỗi dòng 1 giây khi có --segments, còn lại 1 giây.
seconds=1
if [ -n "$segments" ]; then
  mapfile -t lines < <(printf '%s\n' "$text" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$')
  seconds=$(( ${#lines[@]} > 0 ? ${#lines[@]} : 1 ))
  {
    printf '['
    for i in "${!lines[@]}"; do
      [ "$i" -gt 0 ] && printf ','
      line=${lines[$i]//\\/\\\\}
      line=${line//\"/\\\"}
      printf '{"text":"%s","start":%d,"end":%d}' "$line" "$i" "$((i + 1))"
    done
    printf ']'
  } > "$segments"
fi

ffmpeg -v error -y -f lavfi -i "sine=f=440:d=$seconds" -ar 48000 "$out" || exit 1
printf '{"output": "%s", "seconds": %d, "elapsed": 0.1}\n' "$out" "$seconds"
