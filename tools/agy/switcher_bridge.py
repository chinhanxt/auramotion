#!/usr/bin/env python3
"""Cầu nối AuraMotion ↔ antigravity-switcher: lệnh JSON, không bao giờ in token.

Chạy: python3 -I tools/agy/switcher_bridge.py <lệnh> [tham số]
  status                       tài khoản: email, đang dùng, quota % theo nhóm model + giờ reset
  auth-url                     link đăng nhập Google (PKCE) + verifier (giữ phía server)
  exchange [callback verifier] đổi mã lấy refresh token, lưu tài khoản; không có tham số thì đọc JSON
                               {"callback": "...", "verifier": "..."} từ stdin (không lộ trên danh sách tiến trình)
  switch <id|email|auto>       chuyển tài khoản agy đang dùng (auto = còn nhiều quota Gemini nhất)
  remove <id|email>            gỡ tài khoản
  proxy-status|proxy-start|proxy-stop --port N --pid-file F [--log-file L]
Thư mục switcher: env AGY_SWITCHER_DIR (mặc định ~/tool-app/antigravity-switcher).
Kết quả: 1 dòng JSON trên stdout ({"ok": true, ...} hoặc {"ok": false, "error": "..."}), mã thoát 0 / 1.
"""

import contextlib
import json
import os
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SWITCHER_DIR = os.environ.get("AGY_SWITCHER_DIR") or os.path.expanduser("~/tool-app/antigravity-switcher")
OUT = sys.stdout
QUOTA_GROUPS = ["gemini_5h", "gemini_weekly", "claude_5h", "claude_weekly"]
# Chuỗi giống token Google (access ya29., refresh 1//, id token JWT) bị che trước khi in.
SECRET_RE = re.compile(r"(ya29\.[\w.-]+|1//[\w.-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|GOCSPX-[\w-]+)")


def redact(text):
    return SECRET_RE.sub("***", str(text))[:500]


def emit(payload, code=0):
    OUT.write(json.dumps(payload, ensure_ascii=False) + "\n")
    OUT.flush()
    sys.exit(code)


def fail(message):
    emit({"ok": False, "error": redact(message)}, 1)


def load_switcher():
    if not os.path.isfile(os.path.join(SWITCHER_DIR, "switcher.py")):
        fail(f"Không thấy switcher.py trong {SWITCHER_DIR}")
    sys.path.insert(0, SWITCHER_DIR)
    # switcher in chữ màu ra stdout: chuyển sang stderr để stdout chỉ có JSON.
    with contextlib.redirect_stdout(sys.stderr):
        import switcher  # noqa: E402
    return switcher


def public_account(acc):
    return {"id": acc.get("id") or acc.get("email"), "email": acc.get("email")}


def find_account(accounts, target):
    for acc in accounts:
        if target in (acc.get("id"), acc.get("email")):
            return acc
    return None


def quota_of(info):
    out = []
    for group in QUOTA_GROUPS:
        if group in info:
            out.append({"group": group, "pct": info.get(group), "resetAt": info.get(f"{group}_reset")})
    return out


def cmd_status(sw):
    with contextlib.redirect_stdout(sys.stderr):
        accounts = sw.load_accounts()
        results = sw.get_accounts_status(accounts) if accounts else []
    items = []
    for r in results:
        acc = r.get("account") or {}
        item = {
            **public_account(acc),
            "active": bool(r.get("is_active")),
            "status": r.get("status", "VALID"),
            "quota": quota_of(r) if r.get("status") == "VALID" else [],
            "minQuota": r.get("min_quota"),
            "tier": r.get("tier"),
        }
        if r.get("error"):
            item["error"] = redact(r["error"])
        items.append(item)
    emit({"ok": True, "accounts": items})


def cmd_auth_url(sw):
    verifier, challenge = sw.generate_pkce()
    state = secrets.token_hex(16)
    params = urllib.parse.urlencode({
        "access_type": "offline",
        "client_id": sw.CLIENT_ID,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "consent",
        "redirect_uri": sw.REDIRECT_URI,
        "response_type": "code",
        "scope": sw.OAUTH_SCOPES,
        "state": state,
    })
    emit({"ok": True, "url": f"https://accounts.google.com/o/oauth2/auth?{params}", "state": state, "verifier": verifier})


def parse_code(user_input):
    text = user_input.strip()
    code = text
    state = None
    if "code=" in text:
        parsed = urllib.parse.urlparse(text if "://" in text else f"https://dummy.local/?{text.lstrip('?')}")
        qs = urllib.parse.parse_qs(parsed.query)
        if "code" in qs:
            code = qs["code"][0]
        else:
            m = re.search(r"code=([^&]+)", text)
            if m:
                code = m.group(1)
        if "state" in qs:
            state = qs["state"][0]
    return urllib.parse.unquote(code.strip()), state


def cmd_exchange(sw, args):
    if len(args) >= 2:
        callback, verifier = args[0], args[1]
    else:
        try:
            body = json.loads(sys.stdin.read() or "{}")
        except ValueError:
            fail("Dữ liệu stdin không phải JSON")
        callback, verifier = body.get("callback", ""), body.get("verifier", "")
    if not callback or not verifier:
        fail("Thiếu mã callback hoặc verifier")
    code, _state = parse_code(callback)
    if not code:
        fail("Không đọc được mã đăng nhập")
    payload = urllib.parse.urlencode({
        "client_id": sw.CLIENT_ID,
        "client_secret": sw.CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": sw.REDIRECT_URI,
        "code_verifier": verifier,
    }).encode("utf-8")
    req = urllib.request.Request("https://oauth2.googleapis.com/token", data=payload,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        fail(f"Google từ chối mã: HTTP {e.code} {e.read().decode('utf-8', errors='ignore')}")
    except Exception as e:  # noqa: BLE001
        fail(f"Lỗi kết nối Google: {e}")
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        fail("Google không trả refresh token: thu hồi quyền Antigravity tại myaccount.google.com/permissions rồi thử lại")
    with contextlib.redirect_stdout(sys.stderr):
        email = sw.fetch_user_email(data.get("access_token", "")) or f"pro_account_{int(time.time())}@gmail.com"
        accounts = sw.load_accounts()
        acc = next((a for a in accounts if a.get("email") == email), None)
        created = acc is None
        if acc:
            acc["refreshToken"] = refresh_token
            acc["updatedAt"] = int(time.time() * 1000)
        else:
            acc = {"id": email, "email": email, "refreshToken": refresh_token, "addedAt": int(time.time() * 1000)}
            accounts.append(acc)
        sw.save_accounts(accounts)
    emit({"ok": True, "account": public_account(acc), "created": created})


def best_account(results):
    valid = [r for r in results if r.get("status") == "VALID"]
    if not valid:
        return None
    return sorted(
        valid,
        key=lambda x: (min(x.get("gemini_5h", 0.0), x.get("gemini_weekly", 0.0)), x.get("gemini_5h", 0.0), x.get("gemini_weekly", 0.0)),
        reverse=True,
    )[0]


def cmd_switch(sw, args):
    if not args:
        fail("Thiếu id tài khoản")
    target = args[0]
    with contextlib.redirect_stdout(sys.stderr):
        accounts = sw.load_accounts()
        if target == "auto":
            best = best_account(sw.get_accounts_status(accounts) if accounts else [])
            if not best:
                fail("Không có tài khoản agy nào hợp lệ để chuyển")
            acc = best["account"]
            if best.get("is_active"):
                emit({"ok": True, "switched": False, "account": public_account(acc)})
        else:
            acc = find_account(accounts, target)
            if not acc:
                fail(f"Không tìm thấy tài khoản {target}")
        ok = sw.switch_to_account(acc, restart_ide=False, is_interactive=False, notify_desktop=False)
    if not ok:
        fail(f"Không chuyển được sang {acc.get('email')}: token hỏng, cần đăng nhập lại")
    emit({"ok": True, "switched": True, "account": public_account(acc)})


def cmd_remove(sw, args):
    if not args:
        fail("Thiếu id tài khoản")
    with contextlib.redirect_stdout(sys.stderr):
        accounts = sw.load_accounts()
        acc = find_account(accounts, args[0])
        if acc:
            sw.save_accounts([a for a in accounts if a is not acc])
    emit({"ok": True, "removed": acc is not None})


def flag(args, name, default=None):
    if name in args:
        i = args.index(name)
        if i + 1 < len(args):
            return args[i + 1]
    return default


def cmd_proxy(action, args):
    port = flag(args, "--port")
    pid_file = flag(args, "--pid-file")
    if not port or not port.isdigit() or not pid_file:
        fail("Proxy cần --port và --pid-file")
    port = int(port)
    sys.path.insert(0, SWITCHER_DIR)
    with contextlib.redirect_stdout(sys.stderr):
        import proxy  # noqa: E402
        if action == "proxy-start":
            pid = proxy.start_proxy_background(port=port, pid_file=pid_file, log_file=flag(args, "--log-file"))
        elif action == "proxy-stop":
            proxy.stop_proxy(pid_file=pid_file, port=port)
        status = proxy.get_proxy_status(port=port, pid_file=pid_file)
    emit({"ok": True, "running": bool(status.get("running")), "pid": status.get("pid"), "port": port,
          "accountsReady": status.get("accounts_ready")})


def main():
    args = sys.argv[1:]
    if not args:
        fail("Thiếu lệnh")
    cmd, rest = args[0], args[1:]
    try:
        if cmd.startswith("proxy-"):
            if cmd not in ("proxy-status", "proxy-start", "proxy-stop"):
                fail(f"Lệnh không hỗ trợ: {cmd}")
            cmd_proxy(cmd, rest)
        sw = load_switcher()
        if cmd == "status":
            cmd_status(sw)
        elif cmd == "auth-url":
            cmd_auth_url(sw)
        elif cmd == "exchange":
            cmd_exchange(sw, rest)
        elif cmd == "switch":
            cmd_switch(sw, rest)
        elif cmd == "remove":
            cmd_remove(sw, rest)
        else:
            fail(f"Lệnh không hỗ trợ: {cmd}")
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        fail(f"{type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
