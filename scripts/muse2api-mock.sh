#!/usr/bin/env bash
# Chạy muse2api với driver mock cho dev/test (không tốn lượt Muse thật).
#
# Dùng:   MUSE2API_DIR=/path/to/muse2api bash scripts/muse2api-mock.sh
#
# Biến môi trường:
#   MUSE2API_DIR   bắt buộc, thư mục repo muse2api đã tạo .venv
#   MUSE2API_PORT  mặc định 18611 (18610 dành cho muse2api thật)
set -euo pipefail

if [ -z "${MUSE2API_DIR:-}" ] || [ ! -x "$MUSE2API_DIR/.venv/bin/python" ]; then
  cat >&2 <<'MSG'
Thiếu muse2api. Cài đặt:
  git clone https://github.com/www222fff/muse2api
  cd muse2api && python3 -m venv .venv && .venv/bin/pip install -e .
Sau đó chạy lại với MUSE2API_DIR=/đường/dẫn/muse2api
MSG
  exit 1
fi

DATA_DIR="$(mktemp -d)"
trap 'rm -rf "$DATA_DIR"' EXIT

export MUSE2API_DRIVER=mock
export MUSE2API_API_KEY=dev-muse-key
export MUSE2API_DATA_DIR="$DATA_DIR"
export MUSE2API_PORT="${MUSE2API_PORT:-18611}"

# Chạy trong thư mục tạm để không đọc .env của repo muse2api.
cd "$DATA_DIR"
"$MUSE2API_DIR/.venv/bin/python" -m muse2api
