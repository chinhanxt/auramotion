#!/usr/bin/env bash
# Gia hạn phiên mọi tài khoản Muse trong muse2api và báo tài khoản cần nhập lại cookie.
#
# Dùng:   MUSE2API_ADMIN_KEY=... bash scripts/muse-keepalive.sh
# Cron:   */30 * * * * MUSE2API_ADMIN_KEY=... /path/scripts/muse-keepalive.sh >> /var/log/muse-keepalive.log 2>&1
#
# Biến môi trường:
#   MUSE_API_URL        mặc định http://127.0.0.1:18610
#   MUSE2API_ADMIN_KEY  bắt buộc (admin key của muse2api)
#   WARN_DAYS           báo trước khi hatch_sess hết hạn, mặc định 3 ngày
#
# Mã thoát: 0 = mọi tài khoản ổn · 1 = có tài khoản chết / sắp hết hạn · 2 = không gọi được muse2api
set -uo pipefail

BASE="${MUSE_API_URL:-http://127.0.0.1:18610}"
KEY="${MUSE2API_ADMIN_KEY:?Thiếu MUSE2API_ADMIN_KEY}"
WARN_DAYS="${WARN_DAYS:-3}"
AUTH="Authorization: Bearer $KEY"
NOW="$(date +%s)"
TS="$(date '+%F %T')"

LIST="$(curl -sS -m 15 -f "$BASE/admin/accounts" -H "$AUTH")" || {
  echo "$TS LỖI không gọi được muse2api tại $BASE"; exit 2; }

BAD=0
while IFS=$'\t' read -r ID LABEL ENABLED STATUS; do
  if [ "$ENABLED" != "true" ]; then
    echo "$TS $LABEL ($ID) đang tắt, bỏ qua"; continue
  fi

  R="$(curl -sS -m 60 -X POST "$BASE/admin/accounts/$ID/renew" -H "$AUTH")"
  OK="$(jq -r '.ok // false' <<<"$R")"
  VM="$(jq -r '.meta.vm_state_after // .meta.vm_state // "?"' <<<"$R")"
  ERR="$(jq -r '.error // empty' <<<"$R")"

  ACC="$(curl -sS -m 15 "$BASE/admin/accounts" -H "$AUTH" | jq --arg id "$ID" '.data[] | select(.id == $id)')"
  STATUS="$(jq -r '.status' <<<"$ACC")"
  SESS_EXP="$(jq -r '.cookie_expires.hatch_sess // 0 | floor' <<<"$ACC")"
  VML_EXP="$(jq -r '.cookie_expires.hatch_vml // 0 | floor' <<<"$ACC")"
  SESS_LEFT=$(( (SESS_EXP - NOW) / 86400 ))
  VML_LEFT=$(( (VML_EXP - NOW) / 3600 ))

  if [ "$OK" != "true" ] || [ "$STATUS" = "invalid" ]; then
    echo "$TS CHẾT $LABEL ($ID): ${ERR:-status=$STATUS} → cần nhập lại cookie"
    BAD=1
  elif [ "$SESS_EXP" -gt 0 ] && [ "$SESS_LEFT" -lt "$WARN_DAYS" ]; then
    echo "$TS SẮP HẾT HẠN $LABEL ($ID): hatch_sess còn ${SESS_LEFT} ngày → nhập lại cookie trước $(date -d @"$SESS_EXP" '+%F %H:%M')"
    BAD=1
  else
    echo "$TS OK $LABEL ($ID): VM=$VM, hatch_vml còn ${VML_LEFT}h, hatch_sess còn ${SESS_LEFT} ngày"
  fi
done < <(jq -r '.data[] | [.id, (.label // .id), (.enabled|tostring), .status] | @tsv' <<<"$LIST")

exit "$BAD"
