# AuraMotion AI Studio

Hệ thống tạo ảnh & video AI đơn giản, tính phí bằng Credit theo gói **Free / Pro / Ultra**: ảnh/video bằng **MUSE** (muse2api), ảnh và viết prompt bằng CLI **agy** / **codex**, lồng tiếng **VieNeu**, ghép video bằng ffmpeg, kèm cổng quản trị cho Admin.

**Stack:** Next.js · PostgreSQL + Prisma · Redis + BullMQ · lưu file trên ổ đĩa (`STORAGE_DIR`)

## Tài liệu
- [Kế hoạch chức năng MVP](docs/plan.md)
- [Kiến trúc thư mục](docs/architecture.md)
- [Giọng đọc VieNeu](docs/voice-vieneu.md) · [Hậu kỳ ghép video](docs/post-production.md)
- [Phân tích chức năng tham khảo](docs/higgsfield-features.md)

## Chạy trên 1 máy

### 1. Yêu cầu
- Node.js 20+, npm
- Python 3.12 (muse2api, VieNeu, `tools/post/assemble.py`)
- Docker + Docker Compose (Postgres 5433, Redis 6379)
- ffmpeg (có `libass` để đốt phụ đề), font Roboto (`sudo apt install fonts-roboto`)
- Chromium hoặc Chrome (muse2api driver `browser`)
- `curl`, `jq` (cho `scripts/muse-keepalive.sh`)

### 2. Cài app
```bash
git clone <repo> auramotion && cd auramotion
npm ci
cp .env.example .env
```
Điền `.env` (giải thích từng biến nằm ngay trong `.env.example`). Tối thiểu:
- `AUTH_SECRET`: `openssl rand -base64 32`
- `MUSE_API_KEY`: `openssl rand -hex 24` (key app gọi muse2api, `start-all.sh` truyền cho muse2api)
- `MUSE2API_DIR`: đường dẫn repo muse2api (bước 3)
- `SEED_ADMIN_PASSWORD`, `BANK_*`, `PAYMENT_WEBHOOK_SECRET`
- `PORT` và `APP_URL` phải cùng cổng.

> `docker compose` đặt tên project theo tên thư mục. Thư mục khác `auramotion` thì thêm `COMPOSE_PROJECT_NAME=auramotion` vào `.env` để dùng chung container/volume.

### 3. Cài muse2api (MUSE)
```bash
git clone https://github.com/www222fff/muse2api ~/Apps/muse2api
cd ~/Apps/muse2api && python3.12 -m venv .venv && .venv/bin/pip install -e .
```
Trong `.env` của AuraMotion: `MUSE2API_DIR=~/Apps/muse2api` (ghi đường dẫn tuyệt đối), `MUSE2API_DRIVER=browser`. Dev/test không tốn lượt thì đặt `MUSE2API_DRIVER=mock`.

Nhập cookie tài khoản Muse (sau khi đã chạy `scripts/start-all.sh` ở bước 6):
- Mở `http://127.0.0.1:18610/dashboard`, nhập admin key (`MUSE2API_ADMIN_KEY`, bỏ trống thì là `MUSE_API_KEY`).
- Cách 1: tải extension từ dashboard, cài vào trình duyệt đang đăng nhập muse.ai, bấm gửi cookie.
- Cách 2: xuất cookie muse.ai (EditThisCookie JSON hoặc chuỗi `Cookie`, cần ít nhất `hatch_sess`, `hatch_native_auth_device`) rồi dán vào dashboard.
- Mỗi tài khoản Muse chạy được 1 job cùng lúc: đặt `MUSE_CONCURRENCY` bằng số tài khoản.

### 4. Đăng nhập agy và codex
Worker gọi 2 CLI này đúng tài khoản đã đăng nhập trên máy:
```bash
agy             # đăng nhập Google lần đầu, token lưu ở ~/.gemini/antigravity-cli
codex login     # token lưu ở ~/.codex
```
Thư mục đăng nhập khác mặc định thì đặt `AGY_HOME`, `CODEX_HOME`; lệnh không nằm trong PATH thì đặt `AGY_BIN`, `CODEX_BIN`. Mỗi lệnh chạy trong thư mục tạm và bị xóa phiên sau khi xong.

### 5. Cài VieNeu (giọng đọc)
Làm theo [docs/voice-vieneu.md](docs/voice-vieneu.md) (venv `~/Apps/vieneu-tts`, lệnh `vieneu-say`, lần đầu tải model ~3 GB). Kiểm tra:
```bash
vieneu-say --list
vieneu-say "Xin chào" -o /tmp/thu.wav
```
`vieneu-say` không nằm trong PATH thì đặt `VIENEU_BIN`. `ASSEMBLE_PY` là python chạy `tools/post/assemble.py` (mặc định `python3`).

### 6. Tạo DB, dữ liệu mẫu và chạy
```bash
docker compose up -d --wait
npx prisma migrate deploy
npm run db:seed            # gói, engine, preset, nhạc, tài khoản Admin (SEED_ADMIN_*)
bash scripts/start-all.sh
```
`start-all.sh` chạy lần lượt: `docker compose up -d` → muse2api (driver, cổng theo `MUSE_API_URL`) → `prisma migrate deploy` → `npm run build` → `npm start` + `npm run worker`. Log ở `data/logs/` (`muse2api.log`, `build.log`, `app.log`, `worker.log`). **Ctrl+C dừng hết**; một tiến trình chết thì script dừng cả cụm.

- `SKIP_DOCKER=1`: Postgres/Redis đã chạy sẵn.
- `SKIP_BUILD=1`: dùng bản build có sẵn.

Mở `http://localhost:3000` (cổng theo `PORT`), Admin ở `/admin`.

### 7. Giữ phiên Muse (cron mỗi 30 phút)
```bash
crontab -e
*/30 * * * * MUSE2API_ADMIN_KEY=<admin key> /đường/dẫn/auramotion/scripts/muse-keepalive.sh >> /đường/dẫn/auramotion/data/logs/muse-keepalive.log 2>&1
```
Script gia hạn từng tài khoản, in `CHẾT` / `SẮP HẾT HẠN` khi cần nhập lại cookie (mã thoát 1). muse2api không ở cổng 18610 thì thêm `MUSE_API_URL=...`.

### Thanh toán
Đơn mua gói / Credit tạo mã `AM...` và QR VietQR. Dịch vụ báo giao dịch ngân hàng gọi `POST /api/payments/webhook` với body `{"transactionId","amount","description"}` (description chứa mã `AM...`), header `x-signature` = HMAC-SHA256 hex của body bằng `PAYMENT_WEBHOOK_SECRET`. Admin cũng xác nhận tay được ở `/admin/payments`.

## Kiểm thử
```bash
npm test           # cần Postgres + Redis (docker compose), dùng .env.test
npx tsc --noEmit
npm run build
```

## Nghiệm thu thật (chinhan bấm, tốn lượt)
Chạy `start-all.sh` với `MUSE2API_DRIVER=browser`, agy và codex thật. Ghi thời gian từng bước:

| Bước | Thời gian | Ghi chú |
|---|---|---|
| Đăng ký + đăng nhập | | |
| AI viết prompt (agy) | | |
| Ảnh MUSE | | |
| Ảnh agy | | |
| Ảnh codex (Pro) | | |
| Video MUSE 5 s | | |
| Mua Pro (webhook / admin xác nhận) | | |
| Video MUSE 10 s | | |
| Ghép video 3 câu (VieNeu) | | |
| Admin xem số liệu | | |

Lần nghiệm thu với muse2api mock + agy/codex giả + VieNeu thật (06/11): viết prompt ~1 s, ảnh MUSE/agy ~1,4 s, video 5 s/10 s ~5,6 s, ghép video 3 câu **53 s** (gần hết là VieNeu chạy CPU), ra 1080×1920.

## Nhánh
- `main` — bản ổn định, chỉ merge qua PR
- `dev1`, `dev2` — nhánh phát triển
