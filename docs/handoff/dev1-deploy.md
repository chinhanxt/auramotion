# Máy dev1 (server chạy thử)

Repo: `~/projects/auramotion`, nhánh `v2`. Code lấy từ GitHub, không có bí mật nào trong repo.

## Dịch vụ (systemd, tự chạy khi mở máy)
- `auramotion-muse2api`: muse2api của Muse (cổng 18610).
- `auramotion-app`: Next.js (cổng 3000).
- `auramotion-worker`: worker BullMQ.
- `auramotion-ngrok`: tunnel ngrok với domain cố định.
- Unit nằm ở `~/deploy/`. Docker (Postgres, Redis) chạy với `restart: unless-stopped`.

## Đăng nhập và công cụ AI
- **Google (agy):** token lưu dạng tệp `~/.gemini/antigravity-cli/antigravity-oauth-token`. `~/deploy/agy-wrapper.sh` luôn đặt `SSH_CONNECTION` để agy dùng tệp này, không phụ thuộc keyring của desktop.
- **IPv6:** đã tắt trong `/etc/sysctl.d/99-noipv6.conf` vì agy không gọi được Google qua IPv6.
- **Giọng đọc (VieNeu):** môi trường ở `~/Apps/vieneu-tts`, lệnh `~/.local/bin/vieneu-say`. Cần `onnxruntime<1.23`.
- **Muse:** tài khoản nạp qua `/admin/muse`, không lưu trong repo.

## Cấu hình `.env` (không commit)
- `APP_URL`: domain ngrok của máy.
- `AGY_BIN`: `~/deploy/agy-wrapper.sh`.
- `CODEX_BIN`: `~/.local/bin/codex`.
- `VIENEU_BIN`: `~/.local/bin/vieneu-say`.

## Ngrok
- Authtoken nằm ở `~/.config/ngrok/ngrok.yml`, quyền chỉ chủ sở hữu đọc được. Không đưa vào repo.

## Cập nhật code
```bash
cd ~/projects/auramotion
git pull --ff-only
npx next build
sudo systemctl restart auramotion-app auramotion-worker
```
