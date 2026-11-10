#!/usr/bin/env bash
# `codex login --device-auth` giả: in hướng dẫn (có mã màu) rồi chờ; FAKE_LOGIN_FAIL=1 thoát mã 1.
set -u
printf '\033[1mWelcome to Codex\033[0m\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n'
printf '1. Open this link in your browser and sign in to your account\n   \033[94mhttps://auth.openai.com/codex/device\033[0m\n\n'
printf '2. Enter this one-time code \033[90m(expires in 15 minutes)\033[0m\n   \033[94mABCD-1234\033[0m\n\n'
echo "home=$CODEX_HOME" > "$CODEX_HOME/login.txt"
sleep "${FAKE_LOGIN_SLEEP:-0.3}"
if [ -n "${FAKE_LOGIN_FAIL:-}" ]; then echo "Error: device auth timed out"; exit 1; fi
echo "Successfully logged in"
