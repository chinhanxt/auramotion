# AuraMotion

Studio tạo **ảnh & video AI** trên web: người dùng gõ ý tưởng tiếng Việt → AI viết prompt bằng bộ **skill** theo lĩnh vực → gửi đúng model người dùng chọn → ra ảnh/video. Tính phí bằng Credit theo gói Free / Pro / Ultra, có Story nhiều cảnh, ghép video có giọng đọc, và cổng quản trị đầy đủ.

**Stack:** Next.js 15 · React 19 · Tailwind v4 · PostgreSQL + Prisma · Redis + BullMQ · worker riêng · muse2api (Muse) · agy (Google) · codex (OpenAI) · VieNeu + ffmpeg.

## Luồng chính

```
Ý tưởng ─► API (giữ Credit) ─► BullMQ ─► Worker
   ─► AI Gateway: chọn skill (luật → AI) ─► viết prompt (Google → OpenAI → Muse chat) ─► kiểm prompt
   ─► engine người dùng chọn: Muse (ảnh/video) · Google (ảnh) · OpenAI (ảnh)
   ─► kiểm file (ffprobe) ─► lưu ─► SSE cập nhật giao diện
```

- **Chat chính / chat phụ của Muse:** lập kịch bản Story dùng *chat chính* (`story:<id>`); mỗi ảnh/video chạy ở *chat phụ* (tab + thread riêng của muse2api), chạy song song có giới hạn và giãn cách gửi video.
- **Viết trước (prewrite):** AI viết prompt khi người dùng còn đang gõ; bấm Tạo gần như không phải chờ.
- **Model chọn theo tên:** Muse, Google (Flash, Argon, Sonnet, Opus…), OpenAI (Astra, Sol, Terra, Luna…); admin đồng bộ danh sách thật và "Test vẽ" từng model trước khi bật.
- **Skill:** ~60 skill theo lĩnh vực (review, bán hàng, thời trang, gia dụng, làm phim, vlog…), bộ chọn 2 tầng, prompt tự kiểm.
- **Sơ đồ luồng** (`/admin/flow`, React Flow) cho thấy AI nào làm gì ở từng bước, phát lại từng job với thời gian thật.

## Chạy nhanh (1 máy)

Yêu cầu: Node 20+, Docker + Compose, Python 3.12, ffmpeg, Chrome/Chromium, `make`. Cài `agy` / `codex` nếu dùng.

```bash
git clone https://github.com/chinhanxt/auramotion.git && cd auramotion
cp .env.example .env        # điền các giá trị bắt buộc (xem dưới)
make setup                  # npm ci + DB + dữ liệu mẫu
make start                  # build + chạy nền: muse2api + app + worker
```

| Lệnh | Việc |
|---|---|
| `make dev` | chế độ phát triển (`next dev` + worker), Ctrl+C dừng |
| `make start` / `make stop` / `make restart` | chạy nền / dừng / build lại rồi chạy lại |
| `make status` · `make logs` · `make url` | trạng thái · log · địa chỉ LAN |
| `make test` · `make check` | vitest · TypeScript |

Mở `http://localhost:3000`, admin ở `/admin`. Tài khoản admin tạo từ `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` khi chạy seed.

> Lệnh nặng (build, test, tsc) nên chạy **lần lượt**: `flock /tmp/auramotion-heavy.lock <lệnh>` (Makefile đã làm sẵn). Máy 15 GB RAM từng sập khi chạy song song.

### Biến `.env` bắt buộc
`AUTH_SECRET` (`openssl rand -base64 32`), `MUSE_API_KEY` (`openssl rand -hex 24`), `MUSE2API_DIR` (thư mục repo muse2api đã có `.venv`), `SEED_ADMIN_PASSWORD`, `PAYMENT_WEBHOOK_SECRET`, `BANK_*`. `PORT` và `APP_URL` phải khớp. Giải thích từng biến nằm trong `.env.example`.

## Muse (muse2api)

AuraMotion dùng một muse2api **riêng** (cổng 18610, dữ liệu `data/muse2api`, Chrome headless). Quản lý bằng `scripts/muse2api.sh start|stop|restart|status` hoặc `scripts/svc.sh`.

- Nạp tài khoản: `/admin/muse` → *Nhập cookie* (JSON EditThisCookie hoặc chuỗi `Cookie`).
- Mỗi tài khoản chia **loại việc** Ảnh / Video / Chat; hoặc ghim đích danh cho 1 model (Admin → Model → *Tài khoản Muse*). Một tài khoản duy nhất vẫn dùng được cho mọi loại.
- Cần muse2api có `meta.kinds` và header `X-Muse-Account` (repo muse2api, commit `fa9e13d` trở đi).
- Tài khoản Muse bị chặn video theo vùng: hệ thống báo `REGION_BLOCKED`, hoàn Credit và tạm khóa video 6 giờ (gỡ ở admin).

## Google (agy) và OpenAI (codex)

- **agy** chạy thường trực qua ACP (viết prompt ~4 s); ảnh qua công cụ vẽ của agy. Cần tệp token: đăng nhập một lần bằng `SSH_CONNECTION=1 agy` → *Google OAuth* (chạy được không cần desktop). Nhiều tài khoản: antigravity-switcher (`AGY_SWITCHER_DIR`), trang `/admin/ai`.
- **codex** chạy qua `codex app-server` thường trực; model khác nhau theo tài khoản/profile (`~/.codex`, `~/.codex_profiles/*`). Tài khoản không có công cụ tạo ảnh thì tắt model OpenAI trong trang Model.
- `AGY_BIN`, `CODEX_BIN` trỏ tới bản cài thật; `AGY_CONCURRENCY` / `CODEX_CONCURRENCY` giới hạn tiến trình chạy cùng lúc (mặc định 2).
- Giao diện luôn ghi tên hãng (Google / OpenAI / Muse), không ghi tên CLI.

## Quản trị (`/admin`)

Tổng quan · Skill · Theme & Camera · Story · Nổi bật · **Model** (đồng bộ, Test vẽ, giá, gói) · **Muse** (tài khoản, loại việc, slot) · **AI & Model** (tài khoản Google/OpenAI, quota, chuỗi AI viết, bàn test) · **Luồng xử lý** · Hàng đợi · Tác vụ · Người dùng · Gói · Giá Credit · Thanh toán · Nhạc · Cài đặt.

## Triển khai trên 1 máy làm server

Ví dụ đang chạy trên máy dev1 (systemd, tự mở cùng máy):

```bash
docker (Postgres + Redis, restart: unless-stopped)
auramotion-muse2api.service → auramotion-app.service → auramotion-worker.service
auramotion-tunnel.service   # Cloudflare quick tunnel (địa chỉ tạm); có tên miền thì dùng named tunnel
```
Chi tiết, đơn vị systemd và cách đăng nhập agy không cần desktop: xem `docs/handoff/` và `~/deploy` trên máy triển khai.

## Thanh toán

Đơn mua gói/Credit tạo mã `AM…` + QR VietQR. Webhook `POST /api/payments/webhook` (body `{"transactionId","amount","description"}`, header `x-signature` = HMAC-SHA256 hex của body bằng `PAYMENT_WEBHOOK_SECRET`). Admin cũng xác nhận tay ở `/admin/payments`.

## Số đo thật (Muse thật, gói Free, 10/11/2026)

| Việc | Thời gian |
|---|---|
| Viết prompt (Google, ACP) | 3–5 s; đã viết trước ~0,06 s |
| Chọn skill (tầng AI) | ~2–3 s |
| Ảnh Muse | 20–30 s |
| Ảnh Google / OpenAI | 20–45 s |
| Video Muse 5 s | 40–60 s; 3 video song song ~61 s |
| Story 3 cảnh song song + ghép | ~140 s |
| Ghép 2 clip + giọng VieNeu + nhạc + phụ đề | ~72 s |

## Tài liệu

- [Kế hoạch & hợp đồng API v2](docs/v2-plan.md) · [AI runtime](docs/v2-ai-runtime.md) · [Danh mục model](docs/v2-model-catalog.md)
- [Bộ prompt nâng backend từng bước](docs/handoff/dev2-backend-prompts.md)
- [Kiến trúc thư mục](docs/architecture.md) · [Giọng VieNeu](docs/voice-vieneu.md) · [Hậu kỳ ghép video](docs/post-production.md)
- [Kế hoạch MVP cũ](docs/plan.md) · [Phân tích chức năng tham khảo](docs/higgsfield-features.md)

## Kiểm thử

```bash
make test      # vitest (cần Postgres + Redis, dùng .env.test)
make check     # tsc --noEmit
```
Test dùng CLI/HTTP giả trong `tests/fixtures`, không gọi AI thật.

## Nhánh

- `main` — bản ổn định · `dev1`, `dev2` — nhánh phát triển · `v2` — nhánh làm việc (bản v2 đầy đủ)
