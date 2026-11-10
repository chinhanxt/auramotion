"""antigravity-switcher giả cho test: tài khoản lưu trong accounts.json cạnh file này, in rác ra stdout như bản thật."""
import json
import os

HERE = os.path.dirname(os.path.realpath(__file__))
ACCOUNTS = os.path.join(HERE, "accounts.json")
CLIENT_ID = "fake-client"
CLIENT_SECRET = "GOCSPX-fakesecret"
REDIRECT_URI = "https://antigravity.google/oauth-callback"
OAUTH_SCOPES = "openid email"

print("\033[96mswitcher giả đã nạp\033[0m")


def load_accounts():
    print("đọc tài khoản...")
    if not os.path.exists(ACCOUNTS):
        return []
    with open(ACCOUNTS) as f:
        return json.load(f)


def save_accounts(accounts):
    with open(ACCOUNTS, "w") as f:
        json.dump(accounts, f)


def generate_pkce():
    return "verifier-123", "challenge-abc"


def fetch_user_email(access_token):
    return "new@test.local"


def get_accounts_status(accounts):
    print("⏳ đang kiểm tra quota")
    out = []
    for i, acc in enumerate(accounts):
        if acc.get("broken"):
            out.append({"account": acc, "email": acc["email"], "is_active": False, "status": "ERROR",
                        "error": "HTTP 400: invalid_grant for 1//0gSECRETREFRESH ya29.SECRETACCESS"})
            continue
        out.append({"account": acc, "email": acc["email"], "is_active": acc.get("active", False), "status": "VALID",
                    "gemini_5h": 80.0 - i * 30, "gemini_weekly": 90.0, "claude_5h": 50.0, "claude_weekly": 60.0,
                    "gemini_5h_reset": "2026-11-10T20:00:00Z", "gemini_weekly_reset": None,
                    "claude_5h_reset": None, "claude_weekly_reset": None, "min_quota": 50.0, "tier": "Pro"})
    return out


def switch_to_account(account, restart_ide=False, is_interactive=True, notify_desktop=True):
    print(f"chuyển sang {account['email']}")
    accounts = load_accounts()
    for a in accounts:
        a["active"] = a["email"] == account["email"]
    save_accounts(accounts)
    return True
