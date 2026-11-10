"""proxy.py giả: trạng thái lưu trong proxy-state.json cạnh file này."""
import json
import os

STATE = os.path.join(os.path.dirname(os.path.realpath(__file__)), "proxy-state.json")


def _read():
    if not os.path.exists(STATE):
        return {}
    with open(STATE) as f:
        return json.load(f)


def get_proxy_status(port=8899, pid_file=None, accounts_file=None):
    s = _read()
    running = s.get("port") == port and s.get("pid_file") == pid_file
    return {"running": running, "pid": 4242 if running else None, "port": port, "accounts_ready": 2}


def start_proxy_background(port=8899, pid_file=None, log_file=None, accounts_file=None):
    print("khởi động proxy giả")
    with open(STATE, "w") as f:
        json.dump({"port": port, "pid_file": pid_file, "log_file": log_file}, f)
    return 4242


def stop_proxy(pid_file=None, port=8899):
    if os.path.exists(STATE):
        os.remove(STATE)
    return True
