#!/usr/bin/env bash
# vieneu-say giả cho test ghép video: `-f script.txt -o out.wav --segments seg.json [--voice X | --ref Y]`.
# Mỗi dòng của script đọc 1 giây (sine 440 Hz), --segments ghi mốc giờ [{text,start,end}].
# FAKE_SLEEP=<giây>: ngủ trước khi đọc, ghi pid vào FAKE_PIDS (test hủy).
set -eu

file="" out="" seg=""
while [ $# -gt 0 ]; do
  case "$1" in
    -f|--file) file="$2"; shift 2 ;;
    -o|--output) out="$2"; shift 2 ;;
    --segments) seg="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [ -n "${FAKE_SLEEP:-}" ]; then
  echo $$ >> "$FAKE_PIDS"
  sleep "$FAKE_SLEEP"
fi

n=$(grep -c . "$file" || true)
[ "$n" -gt 0 ] || { echo "vieneu-say: không có câu nào" >&2; exit 1; }
ffmpeg -y -v error -f lavfi -i "sine=f=440:d=$n" -ar 24000 -ac 1 "$out"

if [ -n "$seg" ]; then
  python3 - "$file" "$seg" <<'PY'
import json, sys
lines = [l for l in open(sys.argv[1], encoding="utf-8").read().splitlines() if l.strip()]
json.dump([{"text": t, "start": float(i), "end": float(i + 1)} for i, t in enumerate(lines)],
          open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False)
PY
fi
