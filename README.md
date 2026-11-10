# AuraMotion AI Studio

Hệ thống tạo ảnh & video AI đơn giản, tính phí bằng Credit theo gói **Free / Pro / Ultra**: ảnh/video bằng **MUSE** (muse2api), ảnh và viết prompt bằng CLI **agy** / **codex**, lồng tiếng **VieNeu**, ghép video bằng ffmpeg, kèm cổng quản trị cho Admin.

**Stack:** Next.js · PostgreSQL + Prisma · Redis + BullMQ · lưu file trên ổ đĩa (`STORAGE_DIR`)

## Tài liệu
- [Kế hoạch & hợp đồng API v2](docs/v2-plan.md)
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

**AuraMotion chạy muse2api riêng** (không dùng chung với dự án khác): cổng `:18610` (`MUSE_API_URL`), dữ liệu `MUSE2API_DATA_DIR`, Chrome headless riêng (`MUSE2API_CHROMIUM_PATH`, `MUSE2API_CDP_PORT=19230`, `MUSE2API_HEADLESS=true`). Mỗi tài khoản Muse mở tối đa `MUSE2API_ACCOUNT_MAX_CONCURRENCY` tab (đặt 3).

**Chat chính / chat phụ:**
- *Chat phụ*: mỗi request ảnh / video mở 1 thread Muse mới ở 1 tab riêng. Worker giới hạn số chat phụ chạy cùng lúc bằng semaphore Redis (setting `muse_slots`, mặc định `{image:2, video:3, chat:1, gapSec:15, sendVideoAspect:true}`), video gửi cách nhau ≥ `gapSec` giây. Hết slot thì job được dời lại, không tính lần thử.
- *Chat chính*: `/v1/chat/completions` có trường `user` giữ 1 thread. Story dùng `user = story:<id>` để lập kịch bản nhiều cảnh trong 1 hội thoại (JSON hỏng thì nhắn lại 1 câu trong cùng thread rồi mới chuyển provider khác).
- Sau khi tải, file được kiểm bằng ffprobe/ffmpeg (hỏng → `BAD_MEDIA`, tải lại); kích thước / thời lượng thật lưu ở `params.result`.
- Muse báo video không dùng được ở khu vực / tài khoản → job lỗi `REGION_BLOCKED` (hoàn Credit, không thử lại), bật cờ `am:muse:videoBlocked` 6 giờ: tạo video MUSE bị từ chối (`MUSE_VIDEO_UNAVAILABLE`), catalog trả `videoUnavailable: true`. Gỡ ở `/api/admin/muse/video-block/clear`, hoặc tự gỡ khi nhập / gia hạn tài khoản qua admin.

Nhập cookie tài khoản Muse (sau khi đã chạy `scripts/start-all.sh` ở bước 6):
- Mở `http://127.0.0.1:18610/dashboard`, nhập admin key (`MUSE2API_ADMIN_KEY`, bỏ trống thì là `MUSE_API_KEY`).
- Cách 1: tải extension từ dashboard, cài vào trình duyệt đang đăng nhập muse.ai, bấm gửi cookie.
- Cách 2: xuất cookie muse.ai (EditThisCookie JSON hoặc chuỗi `Cookie`, cần ít nhất `hatch_sess`, `hatch_native_auth_device`) rồi dán vào dashboard.
- Có thể nhập cookie ngay trong Admin (`/api/admin/muse/accounts`, proxy tới muse2api bằng `MUSE2API_ADMIN_KEY`).
- `MUSE_CONCURRENCY` (mặc định 4) chỉ là số job worker nhận cùng lúc; số chat phụ thật do `muse_slots` quyết định.

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
Seed v2 thêm: 12 skill prompt, 20 theme STYLE (gồm sơn mài, tranh Đông Hồ, thủy mặc, Đông Dương 1930, Cyber Lotus Sài Gòn…), 8 chuyển động máy CAMERA, setting `ai_gateway`, `muse_slots`, `story`. Chạy lại seed không ghi đè cấu hình Admin đã sửa.

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

### AI Gateway (viết prompt, lập kịch bản)
`src/server/ai/gateway.ts` gọi lần lượt `agy` → `codex` → Muse chat theo setting `ai_gateway` (`{order, agyModel, codexModel, museModel, timeoutSec}`), provider lỗi thì tự chuyển provider kế; độ trễ / lỗi lần cuối từng provider lưu Redis, xem ở `/api/admin/gateway`. Prompt viết theo **skill** (bảng `prompt_skills`, seed 12 skill IMAGE/VIDEO/STORY/SCRIPT) với biến `{{idea}} {{style}} {{camera}} {{aspect}} {{duration}} {{shots}}`.

### Story (nhiều cảnh)
`POST /api/stories` → hàng đợi `story` lập kịch bản bằng chat chính (setting `story` = `{planCost, maxShots, planner, assemble}`; phí lập kịch bản giữ rồi trừ, lỗi thì hoàn) → READY → `POST /render`: tạo 1 job VIDEO / cảnh (giữ Credit từng cảnh, cả story chỉ tính 1 tác vụ đồng thời).
- `PARALLEL`: đưa tất cả vào hàng đợi, scheduler giới hạn chat phụ.
- `CHAIN`: cảnh k+1 chỉ chạy khi cảnh k xong, khung đầu = khung cuối của cảnh k (ffmpeg).
- Xong hết: `autoAssemble` → job ghép (nhạc / giữ tiếng clip) → DONE. Cảnh lỗi: `POST /shots/:index/retry`. Hủy: `DELETE` (hoàn Credit cảnh chưa chạy).

### Realtime
`GET /api/events` (SSE): sự kiện `job` (trạng thái, `progress` 0–100 từ muse2api), `story`, `credit`, `ping` mỗi 20 s. Worker và app publish qua Redis kênh `am:ev:<userId>`.

### Thanh toán
Đơn mua gói / Credit tạo mã `AM...` và QR VietQR. Dịch vụ báo giao dịch ngân hàng gọi `POST /api/payments/webhook` với body `{"transactionId","amount","description"}` (description chứa mã `AM...`), header `x-signature` = HMAC-SHA256 hex của body bằng `PAYMENT_WEBHOOK_SECRET`. Admin cũng xác nhận tay được ở `/admin/payments`.

## Kiểm thử
Lệnh nặng chạy qua `flock /tmp/auramotion-heavy.lock` (máy 15 GB RAM từng sập khi chạy song song):
```bash
flock /tmp/auramotion-heavy.lock npm test           # cần Postgres + Redis (docker compose), dùng .env.test; không gọi Muse / agy / codex thật
flock /tmp/auramotion-heavy.lock npx tsc --noEmit
flock /tmp/auramotion-heavy.lock npm run build
```

## Vận hành nhanh (1 máy, bản build sẵn)
```bash
npm run build                      # nặng ~2,5 GB RAM, chạy một mình
bash scripts/svc.sh start          # muse2api + app + worker chạy nền (pid ở data/*.pid, log ở data/logs/)
bash scripts/svc.sh restart app    # sau mỗi lần build lại
bash scripts/svc.sh status | stop
```
`scripts/muse2api.sh` chỉ quản lý muse2api (đọc `.env`, cổng theo `MUSE_API_URL`, CDP theo `MUSE2API_CDP_PORT`).

### Tài khoản Muse: chat chính, chat phụ, chia việc
- Mỗi request ảnh/video mở **1 thread mới ở 1 tab riêng** của tài khoản = *chat phụ*; số tab mỗi tài khoản = `MUSE2API_ACCOUNT_MAX_CONCURRENCY`. Lập kịch bản Story dùng *chat chính* `story:<id>` (giữ ngữ cảnh để hỏi lại khi AI trả thiếu cảnh).
- AuraMotion giới hạn số chat phụ chạy cùng lúc theo loại (Admin → Muse → Slot: ảnh/video/chat, giãn cách gửi video, gửi tỷ lệ khung).
- **Loại việc theo tài khoản** (Admin → Muse → Loại việc): vd tài khoản bị Muse chặn video theo vùng vẫn để *Ảnh + Chat*; video chỉ đi vào tài khoản cho phép. Cần muse2api có commit `fa9e13d` (`meta.kinds`, header `X-Muse-Account`).
- **Ghim tài khoản cho 1 model**: Admin → Model → *Tài khoản Muse* (ghi `options.museAccount`). Seed tạo sẵn "MUSE Ảnh 2" nếu đặt `SEED_MUSE_IMAGE_ACCOUNT`. Model ghim có slot chat phụ riêng.

## Nghiệm thu thật (10/11/2026, Muse thật gói Free, agy/codex thật)
| Bước | Thời gian | Ghi chú |
|---|---|---|
| AI viết prompt (agy → codex dự phòng) | agy 5,7 s · codex 14–17 s | gateway tự chuyển provider khi lỗi |
| Ảnh MUSE (qua giao diện) | 29 s | "MUSE Ảnh 2" chạy đúng tài khoản ghim |
| Video MUSE 5 s 9:16 (qua giao diện) | 58 s | 720×1280; Muse có lúc trả 10 s |
| 3 video song song (3 chat phụ) | 61 s | gửi cách 15–20 s, file hợp lệ, không trùng |
| Story 3 cảnh · Song song + tự ghép | 139 s | 1080×1920, 15 s |
| Story 3 cảnh · Nối cảnh + tự ghép (qua giao diện) | 287 s | khung cuối cảnh trước = khung đầu cảnh sau, nhân vật giữ nguyên |
| Lập kịch bản bằng chat chính Muse | 14–23 s | JSON hỏng được tự sửa / hỏi lại trong cùng thread |
| Ghép 2 clip + 2 câu VieNeu + nhạc + phụ đề | 72 s | 1080×1920, giọng "Trúc Ly", phụ đề đốt vào video |

Chưa chạy thật: thanh toán qua webhook ngân hàng thật, Codex Ảnh (cần gói Pro).

## Nhánh
- `main` — bản ổn định, chỉ merge qua PR
- `dev1`, `dev2` — nhánh phát triển
- `v2` — bản v2 (giao diện mới, Story, AI Gateway, scheduler Muse, admin mới)
