# AuraMotion E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng AuraMotion MVP chạy được từ đầu đến cuối trên 1 máy: tài khoản → gói → Credit (giữ/trừ/hoàn) → AI viết prompt → tạo ảnh (MUSE / agy / codex) và video (MUSE) → ghép video có giọng VieNeu, nhạc, phụ đề → thư viện → thanh toán QR → cổng Admin.

**Architecture:** 1 app Next.js (trang + API routes) + 1 worker BullMQ với 3 hàng đợi (`muse`, `cli`, `post`). Logic nghiệp vụ trong `src/server/services`; mọi lời gọi engine đi qua `src/server/engines` (`getMuse()`, `getFileEngine(provider)`). Postgres + Redis chạy docker-compose; app, worker, muse2api chạy native vì worker cần `agy`, `codex`, `vieneu-say`, `ffmpeg` có sẵn trên máy. File kết quả lưu trên ổ đĩa (`STORAGE_DIR`), phục vụ qua `/media/...`.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Prisma + PostgreSQL 16, Redis 7 + BullMQ, Auth.js v5 (Credentials + Google), zod, bcryptjs, nodemailer, Tailwind + shadcn/ui, recharts, Vitest. Ngoài repo: muse2api 0.4.0 (Python, venv), agy CLI 1.5, codex CLI 0.166, VieNeu-TTS v3 Turbo (`vieneu-say`), ffmpeg, Python 3.12 (cho `tools/post/assemble.py`).

**Spec:** [`docs/plan.md`](../../plan.md), [`docs/architecture.md`](../../architecture.md), [`docs/voice-vieneu.md`](../../voice-vieneu.md), [`docs/post-production.md`](../../post-production.md)

**Thay thế:** plan `2026-11-06-core-skeleton.md` (bộ xương). So với bản đó: thêm engine agy / codex, AI viết prompt, giọng, ghép video; lưu file trên ổ đĩa thay cho MinIO/R2; muse2api chạy native thay vì docker.

## Global Constraints
- MVP đồ án chạy 1 máy, ít người dùng: chọn cách đơn giản nhất, không làm phần mở rộng quy mô.
- Credit lưu `Decimal(12,2)`, làm tròn HALF_UP 2 chữ số sau mỗi phép tính giá.
- Số dư = tổng `credit_transactions.amount`. Không có cột số dư trên `users`.
- Loại giao dịch: `grant`, `purchase`, `hold`, `charge`, `refund`, `admin_adjust`, `expire`. Bucket: `PLAN`, `PURCHASED`; tiêu credit gói trước.
- Gói seed: Free 20 credit / 1 job cùng lúc / video tối đa 5s · Pro 500 / 3 / 10s · Ultra 2000 / 6 / 10s. Credit gói không cộng dồn; credit mua không hết hạn.
- Giá: ảnh = `baseCost × imageCount`; video = `baseCost × durationSec / 5`; ghép = `baseCost + lines × voice_line_cost` (setting, mặc định 1); viết prompt bằng AI = 0.
- Engine seed: MUSE Ảnh (`muse`, `muse-image`, base 1, n 1/2/4) · Gemini Ảnh (`agy`, `gemini-3.8-flash-medium`, base 1, n 1) · Codex Ảnh (`codex`, model mặc định, base 2, n 1, gói Pro) · MUSE Video (`muse`, `muse-video`, base 3, 5/10s) · Ghép video (`local`, base 2).
- Tỷ lệ: ảnh `1:1, 9:16, 16:9, 4:5`; video `9:16, 16:9, 1:1`.
- Hàng đợi: `muse` concurrency `MUSE_CONCURRENCY` (mặc định 3) · `cli` `CLI_CONCURRENCY` (mặc định 1) · `post` 1. Priority BullMQ: ultra 1, pro 5, free 10.
- Job treo quá thời hạn → `FAILED` (`TIMEOUT`) và hoàn Credit: `muse` 15 phút, `cli` 12 phút, `post` 20 phút.
- muse2api: `MUSE_API_URL` (mặc định `http://127.0.0.1:18610`), header `Authorization: Bearer ${MUSE_API_KEY}`. Ảnh `POST /v1/images/generations` (`async: true`) → poll `GET /v1/images/generations/{id}`, `result.data[].url`. Video `POST /v1/videos` → poll `GET /v1/videos/{id}`, `result.url`. Trạng thái `queued|running|succeeded|failed|cancelled`. Poll mỗi 5 giây. Ảnh trả WebP.
- CLI: mỗi lệnh agy / codex chạy trong thư mục tạm riêng, kill cả nhóm tiến trình khi quá giờ / hủy, xóa thư mục và phiên khi xong. Không đi qua proxy xoay tài khoản.
- Kết quả gói Free giữ 30 ngày. Email nhắc gia hạn 3 ngày trước khi hết hạn.
- Upload: ảnh `image/jpeg|png|webp` ≤ 10 MB; audio mẫu giọng `audio/wav|mpeg|mp4|webm` ≤ 10 MB, 3–30 giây.
- Code (tên biến, hàm) tiếng Anh. Chữ hiển thị cho người dùng tiếng Việt. Commit không ghi tên Claude. Làm trên `dev2`, chỉ push khi chinhan bảo.
- Agent chỉ chạy muse2api driver `mock`. Lệnh tạo ảnh/video thật (tốn lượt Muse, agy, codex) chỉ chạy khi chinhan đồng ý.

## Review Focus
1. **Bấm Tạo hai lần liên tiếp:** hai request giữ Credit cùng lúc không được làm số dư âm. Test `hold is serialized per user` (Task 3).
2. **Worker chết giữa chừng:** Credit đang giữ phải được hoàn bởi sweeper; job MUSE đã có `museTaskId` thì poll tiếp chứ không gửi lại. Test `sweepStuckJobs refunds timed-out jobs`, `processJob resumes without resubmit` (Task 8).
3. **CLI treo hoặc bị hủy:** tiến trình agy / codex phải bị kill cả nhóm và thư mục tạm bị xóa, không để lại session. Test `runCli kills process group on timeout and removes workdir` (Task 13).
4. **Webhook gửi lặp hoặc sai số tiền:** không cộng gói / Credit hai lần, không kích hoạt khi chuyển thiếu. Test `webhook is idempotent`, `underpaid webhook does not fulfill` (Task 9).
5. **Gọi API vượt giới hạn gói hoặc dùng file người khác:** Free gửi `durationSec=10`, dùng engine Codex, hoặc ghép video bằng job của user khác phải bị từ chối ở server. Test `rejects duration above plan`, `rejects model above plan` (Task 4), `assemble rejects foreign job` (Task 18).

---

## File Structure

```
docker-compose.yml                       postgres:16, redis:7
vitest.config.ts · .env.example · .env.test
prisma/schema.prisma · prisma/seed.ts
public/music/*.mp3 + LICENSES.md         4–6 bài CC0 chép từ em-bong flowfit/assets/audio/cc0/music
scripts/muse2api-mock.sh                 chạy muse2api driver mock cho dev/test (cổng 18610)
scripts/start-all.sh                     docker compose up + muse2api + app + worker
scripts/muse-keepalive.sh                (đã có)
tools/post/assemble.py                   (đã có) ghép video
src/lib/db.ts · redis.ts · queue.ts · storage.ts · mail.ts · errors.ts · http.ts · auth.ts
src/middleware.ts
src/server/services/credit.ts · pricing.ts · plan.ts · settings.ts · account.ts · job.ts · payment.ts · admin.ts
src/server/engines/types.ts              EngineProvider, ImageVideoRequest, EngineError
src/server/engines/muse.ts               HttpMuseClient (submit / getTask / health)
src/server/engines/cli.ts                runCli: thư mục tạm, timeout, kill nhóm, dọn
src/server/engines/agy.ts                agyText, agyImage
src/server/engines/codex.ts              codexText, codexImage
src/server/engines/prompt-writer.ts      writePrompt (agy → codex dự phòng)
src/server/engines/voice.ts              listVoices, previewVoice
src/server/engines/assemble.ts           runAssemble (gọi tools/post/assemble.py)
src/server/engines/index.ts              getMuse, getFileEngine, buildPrompt
src/app/api/**/route.ts · src/app/(auth)/** · (user)/** · pricing · admin/** · media/[...key]
src/components/**
worker/index.ts · worker/processors/generate.ts · worker/processors/assemble.ts · worker/cron/index.ts
tests/helpers/db.ts · tests/services/*.test.ts · tests/engines/*.test.ts · tests/api/*.test.ts
tests/fixtures/fake-agy.sh · fake-codex.sh · fake-vieneu-say.sh · sample.png · sample.mp4
```

---

## Phần A — Bộ xương nghiệp vụ

### Task 1: Khởi tạo dự án & hạ tầng dev

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`, `vitest.config.ts`, `.env.test`, `src/lib/db.ts`, `src/lib/redis.ts`, `src/lib/errors.ts`, `src/lib/http.ts`, `tests/helpers/db.ts`, `tests/smoke.test.ts`, `scripts/muse2api-mock.sh`
- Modify: `.env.example`, `.gitignore` (thêm `data/`), xóa `.gitkeep` ở thư mục đã có file thật

**Interfaces:**
- Produces:
  - `db: PrismaClient`, `redis: IORedis`
  - `class AppError extends Error { code: ErrorCode; status: number }`; `type ErrorCode = 'UNAUTHORIZED'|'FORBIDDEN'|'NOT_FOUND'|'VALIDATION'|'INSUFFICIENT_CREDIT'|'CONCURRENCY_LIMIT'|'PLAN_DURATION'|'PLAN_MODEL'|'MAINTENANCE'|'ACCOUNT_LOCKED'|'CONFLICT'|'ENGINE'`
  - `handle(fn: () => Promise<unknown>): Promise<Response>`: 200 JSON; AppError → `{error:{code,message}}` với `status`; ZodError → 400 `VALIDATION`.
  - `resetDb(): Promise<void>`: TRUNCATE mọi bảng CASCADE.

- [ ] **Step 1:** `npx create-next-app@15 . --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint`; cài `prisma @prisma/client bullmq ioredis zod bcryptjs next-auth@5 nodemailer recharts`, dev `vitest @types/bcryptjs @types/nodemailer tsx`. Script: `dev`, `worker` (`tsx worker/index.ts`), `test` (`vitest run`), `db:migrate`, `db:seed`.
- [ ] **Step 2:** `docker-compose.yml`: postgres:16 (5432), redis:7 (6379). `scripts/muse2api-mock.sh`: chạy `$MUSE2API_DIR/.venv/bin/python -m muse2api` với `MUSE2API_DRIVER=mock`, `MUSE2API_API_KEY=dev-muse-key`, `MUSE2API_DATA_DIR=$(mktemp -d)`; thiếu `MUSE2API_DIR` thì in hướng dẫn cài (`git clone https://github.com/www222fff/muse2api` + venv) và thoát 1. `.env.test`: DB `auramotion_test`, `MUSE_API_KEY=dev-muse-key`, `STORAGE_DIR=./data/test-storage`.
- [ ] **Step 3: Viết test** `smoke.test.ts`: `handle(() => { throw new AppError('NOT_FOUND','x',404) })` → status 404, body `{error:{code:'NOT_FOUND',message:'x'}}`.
- [ ] **Step 4:** `npm test` → FAIL. Viết `errors.ts`, `http.ts`, `db.ts`, `redis.ts`. `docker compose up -d && npm test && npm run build` → PASS, build OK.
- [ ] **Step 5: Commit** `chore: khởi tạo Next.js, Prisma, Vitest, docker-compose`

---

### Task 2: Schema & seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/server/services/settings.ts`, `tests/services/seed.test.ts`, `public/music/` (chép 5 bài: `music-funky-house`, `music-energetic-jazz-funk`, `music-happy-clap-17s`, `music-cozy-acoustic`, `music-lofi-chill-loop` + `LICENSES.md` từ em-bong)

**Interfaces:**
- Produces các model Prisma:
  - `User { id, email @unique, passwordHash?, googleId? @unique, name, avatarUrl?, role: USER|ADMIN, status: ACTIVE|LOCKED, createdAt }`
  - `PasswordResetToken { id, userId, tokenHash @unique, expiresAt, usedAt? }`
  - `Plan { id, code @unique: free|pro|ultra, name, priceMonth Int, priceYear Int, monthlyCredits Decimal, maxConcurrent Int, maxDurationSec Int, rank Int }` (VND; rank 0/1/2)
  - `Subscription { id, userId, planId, period: MONTH|YEAR, startAt, endAt?, nextGrantAt, status: ACTIVE|EXPIRED|CANCELED, remindedAt? }`
  - `CreditTransaction { id, userId, type, bucket: PLAN|PURCHASED, amount Decimal(12,2), jobId?, paymentId?, actorId?, note?, createdAt }`, index `(userId)`, `(jobId)`
  - `AiModel { id, name, provider: MUSE|AGY|CODEX|LOCAL, engineModel String, kind: IMAGE|VIDEO|ASSEMBLE, minPlanRank Int, baseCost Decimal, options Json, enabled Boolean, sort Int }`; `options = { aspectRatios?: string[], counts?: number[], durations?: number[], maxRefs?: number }`
  - `Preset { id, kind: STYLE|CAMERA, name, promptSuffix, thumbnailUrl?, enabled }`
  - `Job { id, userId, modelId, kind: IMAGE|VIDEO|ASSEMBLE, prompt, params Json, inputUrl?, status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED, cost Decimal, museTaskId?, resultUrls String[], error?, createdAt, startedAt?, finishedAt?, deletedAt?, expiresAt? }`
  - `Payment { id, userId, type: PLAN|CREDIT, planCode?, period?, creditAmount Decimal?, amount Int, refCode @unique, status: PENDING|SUCCEEDED|CANCELED, providerTxnId? @unique, paidAt?, confirmedBy?, createdAt }`
  - `Setting { key @id, value Json }`
- Produces `getSetting<T>(key): Promise<T>`, `setSetting(key, value): Promise<void>`.
- Seed settings: `maintenance: false`, `credit_packs: [{credits:100,price:…},{credits:500,…},{credits:1000,…}]`, `voice_line_cost: 1`, `prompt_writer: {provider:'agy', model:'claude-sonnet-4-6'}`, `music_tracks: [{id:'funky-house', name:'Funky House', file:'/music/music-funky-house.mp3'}, …]`.

- [ ] **Step 1: Viết test** `seed.test.ts` sau `seed()`:
  ```ts
  expect(await db.plan.count()).toBe(3)
  expect((await db.plan.findUnique({where:{code:'free'}}))!.maxDurationSec).toBe(5)
  expect((await db.aiModel.findMany({where:{enabled:true}, orderBy:{sort:'asc'}})).map(m => `${m.provider}:${m.kind}`))
    .toEqual(['MUSE:IMAGE','AGY:IMAGE','CODEX:IMAGE','MUSE:VIDEO','LOCAL:ASSEMBLE'])
  expect((await db.aiModel.findFirst({where:{provider:'CODEX'}}))!.minPlanRank).toBe(1)
  expect(await getSetting('voice_line_cost')).toBe(1)
  expect(await db.user.count({where:{role:'ADMIN'}})).toBe(1)
  ```
  Chạy lại `seed()` lần 2 → số dòng không đổi.
- [ ] **Step 2:** Chạy test → FAIL. Viết schema, seed (upsert), admin từ `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, preset style (Studio, Ngoài trời, Trên tay, Lifestyle) và camera (Zoom In, Zoom Out, Pan trái, Pan phải, Xoay 360, Tĩnh).
- [ ] **Step 3:** `npx prisma migrate dev --name init && npm test` → PASS.
- [ ] **Step 4: Commit** `feat(db): schema và seed gói, engine, preset, nhạc`

---

### Task 3: Sổ Credit

**Files:** Create `src/server/services/credit.ts`, `tests/services/credit.test.ts`

**Interfaces:**
- Produces:
  - `type Tx = Prisma.TransactionClient`
  - `getBalance(userId, tx?): Promise<{ available: Decimal; plan: Decimal; purchased: Decimal; held: Decimal }>`
  - `grant(userId, amount, opts: { type: 'grant'|'purchase'; paymentId?; note? }, tx?)`: `grant` → PLAN, `purchase` → PURCHASED
  - `expirePlanCredits(userId, tx?)`: ghi `expire` âm bằng số dư PLAN (bỏ qua ≤ 0)
  - `hold(tx, userId, jobId, amount)`: âm, PLAN trước rồi PURCHASED (1–2 dòng); khóa `SELECT id FROM "User" WHERE id = $1 FOR UPDATE` trước khi đọc số dư; thiếu → `INSUFFICIENT_CREDIT`
  - `charge(jobId, tx?)`: 1 dòng `amount = 0` đánh dấu chốt; gọi lại không làm gì
  - `refund(jobId, tx?)`: dương, trả đúng bucket; idempotent; sau `charge` không làm gì
  - `adminAdjust(userId, amount, actorId, reason)`: bucket PURCHASED; `reason` rỗng → `VALIDATION`; trừ quá → `INSUFFICIENT_CREDIT`
  - `held` = tổng hold của job chưa có `charge` / `refund`. `amount = 0` (job miễn phí) thì `hold` không ghi dòng nào.

- [ ] **Step 1: Viết test**: `grant then balance` (20 → available 20, plan 20) · `hold takes plan bucket first` (plan 5 + purchased 10, hold 8 → plan 0, purchased 7, held 8) · `hold insufficient` · `charge is idempotent` · `refund returns to same buckets` · `refund after charge is no-op` · `hold is serialized per user` (available 5, `Promise.allSettled` 2 hold × 3 → 1 fulfilled, 1 rejected, available 2) · `expirePlanCredits keeps purchased` · `adminAdjust requires reason` · `zero hold writes nothing`.
- [ ] **Step 2:** Chạy → FAIL. Viết `credit.ts`. Chạy → PASS.
- [ ] **Step 3: Commit** `feat(credit): sổ giao dịch giữ/trừ/hoàn theo bucket`

---

### Task 4: Báo giá & kiểm tra tham số

**Files:** Create `src/server/services/pricing.ts`, `tests/services/pricing.test.ts`

**Interfaces:**
- Consumes: `AiModel`, `Plan`, `getSetting('voice_line_cost')`
- Produces:
  - `generationParamsSchema` (zod):
    ```ts
    type GenerationParams =
      | { kind: 'image'; modelId: string; prompt: string /*1..2000*/; aspectRatio: string; imageCount?: 1|2|4; presetId?: string; inputUrl?: string }
      | { kind: 'video'; modelId: string; prompt: string; aspectRatio: string; durationSec?: 5|10; presetId?: string; inputUrl?: string }
      | { kind: 'assemble'; modelId: string; aspect: '9:16'|'16:9'|'1:1';
          clips: { jobId: string; index?: number; in?: number; out?: number; duration?: number }[] /*1..12*/;
          lines: string[] /*0..20, mỗi dòng 1..200 ký tự*/; voice?: { preset?: string; refUrl?: string };
          musicId?: string; subtitles: boolean; keepClipAudio: boolean }
    ```
  - `type AssembleParams = Extract<GenerationParams, { kind: 'assemble' }>`
  - `validateParams(p, model, plan): void` (thuần, không truy vấn DB)
  - `quote(p, model): Promise<Decimal>`
- Luật `validateParams`: `model.kind` khác `p.kind`, hoặc `aspectRatio` / `imageCount` / `durationSec` không có trong `model.options` → `VALIDATION`; `model.minPlanRank > plan.rank` → `PLAN_MODEL`; `durationSec > plan.maxDurationSec` → `PLAN_DURATION`; `voice.refUrl` (clone) với `plan.rank < 1` → `PLAN_MODEL`.
- `quote`: ảnh `baseCost × (imageCount ?? 1)`; video `baseCost × (durationSec ?? 5) / 5`; ghép `baseCost + lines.length × voice_line_cost`; làm tròn 2 chữ số.

- [ ] **Step 1: Viết test**: MUSE ảnh × 1 = `1.00`, × 4 = `4.00` · Codex ảnh × 1 = `2.00` · video 5s = `3.00`, 10s = `6.00` · ghép 3 câu = `5.00`, 0 câu = `2.00` · `rejects duration above plan` (Free, 10s → `PLAN_DURATION`) · `rejects model above plan` (Free + Codex → `PLAN_MODEL`) · agy ảnh `imageCount: 2` → `VALIDATION` · ảnh tỷ lệ `21:9` → `VALIDATION` · Free ghép với `voice.refUrl` → `PLAN_MODEL`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(pricing): báo giá ảnh, video, ghép và giới hạn theo gói`

---

### Task 5: Gói & thuê bao

**Files:** Create `src/server/services/plan.ts`, `src/lib/mail.ts`, `tests/services/plan.test.ts`

**Interfaces:**
- Consumes: `grant`, `expirePlanCredits`
- Produces:
  - `getActivePlan(userId): Promise<{ plan: Plan; subscription: Subscription }>`
  - `startFree(userId, tx?, now?)`: sub Free (`endAt null`, `nextGrantAt = now + 1 tháng`), grant credit Free
  - `activatePlan(userId, planCode: 'pro'|'ultra', period: 'MONTH'|'YEAR', now?, tx?)`: đóng sub cũ (CANCELED), `expirePlanCredits`, sub mới (`endAt` +1 tháng / +1 năm, `nextGrantAt` +1 tháng), grant. Mua lại đúng gói đang có → chỉ cộng `endAt` từ `endAt` cũ, không cấp thêm credit.
  - `runMonthlyGrants(now)`, `expireSubscriptions(now)` (hết hạn → EXPIRED, expire credit gói, `startFree`), `sendRenewalReminders(now)` (còn ≤ 3 ngày, `remindedAt null` → mail, set `remindedAt`)
  - `sendMail(to, subject, html)`: thiếu `SMTP_HOST` thì `console.info`

- [ ] **Step 1: Viết test**: `startFree grants 20` · `activatePlan pro replaces free credits` (Free còn 12 + purchased 5 → plan 500, purchased 5) · `yearly plan grants monthly` · `expire falls back to free` · `renewal reminder sent once` · `renew same plan extends endAt`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(plan): thuê bao, cấp credit theo kỳ, hết hạn về Free`

---

### Task 6: Xác thực & tài khoản

**Files:** Create `src/lib/auth.ts`, `src/middleware.ts`, `src/server/services/account.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/{register,forgot-password,reset-password}/route.ts`, `src/app/api/me/route.ts`, `src/app/api/me/password/route.ts`, `src/app/(auth)/{login,register,forgot-password,reset-password}/page.tsx`, `tests/services/account.test.ts`

**Interfaces:**
- Consumes: `startFree`, `sendMail`
- Produces:
  - `registerUser({ email, password /*≥8*/, name }): Promise<User>`: email lowercase; trùng → `CONFLICT`; 1 transaction tạo user + `startFree`
  - `verifyCredentials(email, password): Promise<User | null>` (LOCKED → null)
  - `upsertGoogleUser({ googleId, email, name, avatarUrl? })`: khớp googleId → email (gắn googleId) → tạo mới + `startFree`
  - `requestPasswordReset(email)`: luôn OK; token 32 byte, lưu sha256, 1 giờ, link `${APP_URL}/reset-password?token=`
  - `resetPassword(token, newPassword)`: sai / hết hạn / đã dùng → `VALIDATION`
  - `updateProfile(userId, { name?, avatarUrl? })`, `changePassword(userId, oldPw, newPw)`
  - `requireUser(): Promise<User>`: đọc session rồi **lấy user từ DB**; không có → `UNAUTHORIZED`; LOCKED → `ACCOUNT_LOCKED`
  - `requireAdmin(): Promise<User>`: thêm `role !== ADMIN` → `FORBIDDEN`
  - Session JWT `{ userId, role }`. `middleware.ts`: chưa đăng nhập vào `/studio`, `/library`, `/credits`, `/profile`, `/admin` → `/login`.

- [ ] **Step 1: Viết test**: `register creates free plan and 20 credits` · `register duplicate email (case-insensitive)` · `verifyCredentials wrong password` · `google links existing email account` · `reset token single use` · `requireUser rejects locked user`.
- [ ] **Step 2:** FAIL → viết service, Auth.js config, route, trang auth → PASS.
- [ ] **Step 3:** Kiểm tay `npm run dev`: đăng ký → vào `/studio/image`; đăng xuất → `/studio/image` chuyển về `/login`.
- [ ] **Step 4: Commit** `feat(auth): đăng ký, đăng nhập, Google, quên mật khẩu`

---

### Task 7: Lưu file trên ổ đĩa & upload

**Files:** Create `src/lib/storage.ts`, `src/app/media/[...key]/route.ts`, `src/app/api/uploads/route.ts`, `tests/services/storage.test.ts`

**Interfaces:**
- Produces:
  - `storagePath(key: string): string` = `path.join(STORAGE_DIR, key)`; key có `..` hoặc bắt đầu bằng `/` → `VALIDATION`
  - `putFile(srcPath: string, key: string): Promise<string>`: chép file, trả URL `/media/${key}`
  - `putFromUrl(srcUrl: string, key: string, headers?: Record<string,string>): Promise<string>`: tải về rồi lưu (dùng cho file muse2api, gửi kèm Bearer)
  - `saveUpload(userId, file: File, kind: 'image'|'audio'): Promise<{ url: string; path: string }>`: kiểm loại / cỡ theo Global Constraints; audio đo thời lượng bằng `ffprobe` (3–30 giây); key `uploads/{userId}/{uuid}.{ext}`
  - `deleteByUrls(urls: string[]): Promise<void>`
  - `GET /media/[...key]`: stream file với `Content-Type` theo đuôi, hỗ trợ `Range` (video tua được); không có → 404
  - `POST /api/uploads` (multipart `file`, `kind`) → `saveUpload`

- [ ] **Step 1: Viết test**: `putFile then storagePath exists` · `rejects path traversal key` (`../x`) · `saveUpload rejects gif and >10MB` · `saveUpload rejects audio shorter than 3s` (dùng `ffmpeg -f lavfi -i anullsrc -t 1` tạo file mẫu) · `deleteByUrls removes files`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(storage): lưu file trên ổ đĩa, upload ảnh/audio, phục vụ /media`

---

### Task 8: Job, hàng đợi, worker & engine MUSE

**Files:** Create `src/lib/queue.ts`, `src/server/engines/types.ts`, `src/server/engines/muse.ts`, `src/server/engines/index.ts`, `src/server/services/job.ts`, `worker/index.ts`, `worker/processors/generate.ts`, `worker/cron/index.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/[id]/params/route.ts`, `src/app/api/jobs/quote/route.ts`, `tests/engines/muse.test.ts`, `tests/services/job.test.ts`

**Interfaces:**
- Consumes: `validateParams`, `quote`, `hold`, `charge`, `refund`, `getActivePlan`, `getSetting('maintenance')`, `putFromUrl`, `putFile`, `deleteByUrls`, `requireUser`
- Produces:
  - `queues: Record<'muse'|'cli'|'post', Queue<{ jobId: string }>>`; `queueFor(provider): 'muse'|'cli'|'post'` (MUSE → muse, AGY/CODEX → cli, LOCAL → post)
  - `types.ts`:
    ```ts
    type MediaRequest = { kind: 'image'|'video'; engineModel: string; prompt: string; aspectRatio: string;
      imageCount?: number; durationSec?: number; inputPath?: string; inputUrl?: string }
    class EngineError extends Error { code: string; retryable: boolean }
    interface FileEngine { generate(req: MediaRequest, signal?: AbortSignal): Promise<{ files: string[] }> }  // agy, codex
    ```
  - `muse.ts` — `HttpMuseClient`:
    - `submit(req: MediaRequest): Promise<{ taskId: string }>`: ảnh `POST /v1/images/generations` `{ model, prompt, size: aspectRatio, n: imageCount, image: inputUrl, async: true, response_format: 'url' }`; video `POST /v1/videos` `{ model, prompt, size, duration: durationSec, image: inputUrl }`. `inputUrl` gửi dạng data URL đọc từ `inputPath` (muse2api chặn URL nội bộ).
    - `getTask(kind, taskId): Promise<{ status; urls: string[]; error?: string }>`
    - `health(): Promise<{ ok: boolean; accounts?: number; driver?: string }>` (`GET /readyz`)
    - HTTP 429/5xx/lỗi mạng → `EngineError(retryable: true)`; 4xx khác → `retryable: false`; mỗi request timeout 30 s.
  - `index.ts`: `getMuse(): HttpMuseClient`, `getFileEngine(provider: 'AGY'|'CODEX'): FileEngine` (Task 14, 15 đăng ký), `buildPrompt(prompt, preset?)` = `prompt` + `", " + promptSuffix`
  - `job.ts`:
    - `createJob(userId, p: GenerationParams): Promise<Job>`: bảo trì → `MAINTENANCE`; model tắt / không có → `NOT_FOUND`; `validateParams`; đếm job PENDING + RUNNING ≥ `plan.maxConcurrent` → `CONCURRENCY_LIMIT`; 1 transaction: tạo Job PENDING (`cost = quote`, `expiresAt = now + 30 ngày` nếu Free) + `hold`; ngoài transaction: `queues[queueFor(model.provider)].add(kind, { jobId }, { priority, jobId })`.
    - `processJob(jobId, deps?: { muse?: HttpMuseClient; engines?: Record<string, FileEngine>; pollMs?: number }): Promise<void>` — xem luật dưới
    - `finishJob(jobId, files: { url?: string; path?: string }[], headers?)`: lưu từng file vào `results/{userId}/{jobId}/{i}.{ext}` (đuôi theo `Content-Type` / file gốc, WebP giữ WebP) → SUCCEEDED, `resultUrls`, `finishedAt`, `charge`
    - `failJob(jobId, error: string)`: FAILED, `refund`
    - `sweepStuckJobs(now)`: PENDING / RUNNING quá hạn theo hàng đợi (15 / 12 / 20 phút) → `failJob(id, 'TIMEOUT')`
    - `cancelJob(jobId)` (chỉ PENDING), `retryJob(jobId)` (chỉ FAILED → `createJob` cùng params), `deleteJob(userId, jobId)` (khác user → `NOT_FOUND`; set `deletedAt`, xóa file), `listJobs(userId, { kind?, status?, cursor?, ids? })` (24/trang, bỏ đã xóa), `cleanupExpiredResults(now)`
- Luật `processJob`:
  - Chạy khi job PENDING, hoặc RUNNING đã có `museTaskId` (MUSE poll tiếp, không gửi lại). Job khác trạng thái → bỏ qua.
  - MUSE: chưa có `museTaskId` → RUNNING, `startedAt`, `submit` (prompt đã ghép preset), lưu `museTaskId`; poll `getTask` mỗi `pollMs` (mặc định 5000); lỗi poll retryable → poll tiếp; `succeeded` → `finishJob(urls, Bearer header)`; `failed` / `cancelled` → `failJob`.
  - AGY / CODEX: RUNNING, `startedAt`, `engine.generate(req)` → `finishJob(files.map(path => ({ path })))`; `EngineError` → `failJob(code)`.
  - LOCAL (ghép): giao cho `processAssemble` (Task 17). Trước khi có Task 17 thì `failJob('NOT_IMPLEMENTED')`.
  - `submit` / CLI lỗi retryable: ném lại để BullMQ thử (`attempts: 3`, backoff 10 s); hết lượt → `failJob`.
- `worker/index.ts`: 3 `Worker` theo `queues` với concurrency trong Global Constraints, gọi `processJob`; cron BullMQ mỗi 5 phút `sweepStuckJobs`, `runMonthlyGrants`, `expireSubscriptions`; hằng ngày `sendRenewalReminders`, `cleanupExpiredResults`.
- API: `POST /api/jobs/quote` → `{ cost }` · `POST /api/jobs` · `GET /api/jobs?kind&status&cursor&ids` · `DELETE /api/jobs/:id` · `GET /api/jobs/:id/params`.

- [ ] **Step 1: Viết test** `muse.test.ts` (muse2api mock qua `scripts/muse2api-mock.sh`, khởi động trong `globalSetup`): `submit image then poll succeeds` (n 2 → 2 url) · `submit video then poll succeeds` · `bad api key throws non-retryable` · `server down throws retryable` · `health ok`.
- [ ] **Step 2: Viết test** `job.test.ts` (mock `queues.*.add`; muse và FileEngine là stub; `pollMs: 1`; storage thật vào `STORAGE_DIR` test):
  - `createJob holds credit` (Free 20, MUSE ảnh × 2 → cost 2, available 18, held 2) · `createJob routes agy to cli queue` · `createJob concurrency limit` · `createJob in maintenance`
  - `processJob muse success charges` (stub `running` → `succeeded` 2 url → SUCCEEDED, 2 file trong storage, `museTaskId` lưu, held 0)
  - `processJob muse failure refunds` · `processJob resumes without resubmit` · `processJob twice is no-op`
  - `processJob file engine success` (stub trả `tests/fixtures/sample.png` → SUCCEEDED, file `.png`)
  - `sweepStuckJobs refunds timed-out jobs` (MUSE RUNNING 16 phút → FAILED `TIMEOUT`, available 20; CLI RUNNING 11 phút → giữ nguyên)
  - `cancelJob only pending` · `deleteJob other user` → `NOT_FOUND` · `cleanupExpiredResults` xóa job Free quá 30 ngày
- [ ] **Step 3:** FAIL → viết → PASS.
- [ ] **Step 4:** Kiểm tay với muse2api mock: `npm run dev` + `npm run worker`, `curl POST /api/jobs` (kèm cookie) → sau 5–10 s job SUCCEEDED, mở được `/media/results/...`.
- [ ] **Step 5: Commit** `feat(job): tạo job, 3 hàng đợi, worker, engine MUSE, sweeper, cron`

---

### Task 9: Thanh toán QR

**Files:** Create `src/server/services/payment.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/[id]/route.ts`, `src/app/api/payments/webhook/route.ts`, `tests/services/payment.test.ts`; Modify `.env.example` (`BANK_ID`, `BANK_ACCOUNT`, `BANK_ACCOUNT_NAME`, `PAYMENT_WEBHOOK_SECRET`)

**Interfaces:**
- Consumes: `activatePlan`, `grant`, `getSetting('credit_packs')`
- Produces:
  - `createOrder(userId, { type:'PLAN'; planCode; period } | { type:'CREDIT'; credits: 100|500|1000 }): Promise<Payment & { qrUrl: string }>`; `refCode` = `"AM"` + 8 ký tự `[A-Z0-9]`; `qrUrl` = `https://img.vietqr.io/image/${BANK_ID}-${BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${refCode}&accountName=${encodeURIComponent(BANK_ACCOUNT_NAME)}`
  - `handleWebhook(rawBody, signature)`: HMAC-SHA256 hex sai → `UNAUTHORIZED`; body `{ transactionId, amount, description }`; tìm `/AM[A-Z0-9]{8}/`; không thấy / `providerTxnId` đã xử lý → `{ok:true}`; thiếu tiền → giữ PENDING, log; đủ → `fulfillPayment`. (Định dạng chung; khi chọn SePay / Casso thì đổi parser + cách ký.)
  - `fulfillPayment(paymentId, { providerTxnId?, confirmedBy? })`: 1 transaction, chỉ khi PENDING → SUCCEEDED; PLAN → `activatePlan`; CREDIT → `grant('purchase')`
  - `GET /api/payments/:id` (trang QR poll 3 s)

- [ ] **Step 1: Viết test**: `createOrder plan uses plan price` · `refCode matches /^AM[A-Z0-9]{8}$/` · `webhook bad signature` · `webhook fulfills credit order` · `webhook is idempotent` · `underpaid webhook does not fulfill` · `fulfill plan order activates pro`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(payment): đơn QR, webhook, kích hoạt gói/credit`

---

### Task 10: UI Studio ảnh / video & Thư viện

**Files:** Create `src/app/(user)/layout.tsx`, `src/app/(user)/studio/image/page.tsx`, `src/app/(user)/studio/video/page.tsx`, `src/app/(user)/library/page.tsx`, `src/app/(user)/library/[id]/page.tsx`, `src/components/studio/{GenerateForm,EngineSelect,AspectRatioPicker,PresetPicker,ImageUpload,GenerateButton,PromptBox}.tsx`, `src/components/library/{JobGrid,JobCard,MediaViewer}.tsx`, `src/app/api/catalog/route.ts`, `tests/api/catalog.test.ts`

**Interfaces:**
- Consumes: API Task 8, `POST /api/uploads`, `POST /api/ai/prompt` (Task 13 — trước khi có thì ẩn nút)
- Produces: `GET /api/catalog?kind=image|video|assemble` → `{ models: (AiModel & { locked: boolean })[]; presets: Preset[]; plan: Plan; music?: {id,name,file}[] }`; `locked` = `minPlanRank > plan.rank`; chỉ model / preset đang bật.
- Hành vi:
  - Layout: sidebar (Tạo ảnh · Tạo video · Ghép video · Thư viện · Credit · Hồ sơ), header hiện số dư.
  - `GenerateForm`: đổi tham số → `/api/jobs/quote` (debounce 300 ms) → nút `Tạo · {cost} Credit`. Lỗi: `INSUFFICIENT_CREDIT` → link `/credits`; `CONCURRENCY_LIMIT` → "Bạn đang có N tác vụ chạy, vui lòng chờ"; `MAINTENANCE` → "Hệ thống đang bảo trì"; `PLAN_*` → "Cần gói Pro".
  - Ảnh: `EngineSelect` (MUSE / Gemini / Codex, khóa hiện nhãn "Pro"); số ảnh chỉ hiện khi engine có `counts` > 1; tỷ lệ; preset style; 1 ảnh tham chiếu. Engine agy / codex hiện ghi chú "mỗi ảnh mất 1–4 phút".
  - Video: tỷ lệ; 5/10s (vượt `plan.maxDurationSec` → nhãn "Pro", không chọn được); preset camera; ảnh khung đầu.
  - `PromptBox`: ô prompt + nút "AI viết prompt" (ẩn nếu chưa có API).
  - `?from={jobId}` → điền form từ `/api/jobs/:id/params` (Tạo lại).
  - `JobGrid`: tab Ảnh / Video / Video ghép, lọc trạng thái; job PENDING / RUNNING poll `GET /api/jobs?ids=` mỗi 3 s. Chi tiết: xem, prompt, tham số, cost, Tải xuống / Tạo lại / Xóa.

- [ ] **Step 1: Viết test** `catalog.test.ts`: user Free `kind=image` → Codex `locked: true`, MUSE `locked: false`; `kind=video` chỉ preset CAMERA; tắt MUSE Video → không xuất hiện.
- [ ] **Step 2:** FAIL → route → PASS. Viết trang, component.
- [ ] **Step 3:** Kiểm tay (dev + worker + muse2api mock): tạo ảnh MUSE 2 tấm → nút `2 Credit`, số dư giảm 2, thẻ "Đang xử lý" → "Hoàn tất"; Tạo lại điền đúng form; Xóa → thẻ biến mất.
- [ ] **Step 4: Commit** `feat(ui): studio ảnh/video và thư viện`

---

### Task 11: UI Credit, Hồ sơ, Bảng giá

**Files:** Create `src/app/(user)/credits/page.tsx`, `src/app/(user)/credits/pay/[id]/page.tsx`, `src/app/(user)/profile/page.tsx`, `src/app/pricing/page.tsx`, `src/app/api/credits/route.ts`, `tests/api/credits.test.ts`

**Interfaces:**
- Consumes: `getBalance`, `getActivePlan`, `createOrder`, `updateProfile`, `changePassword`
- Produces: `GET /api/credits?cursor` → `{ balance, plan, subscription, transactions (30/trang), payments }`
- Hành vi: `/pricing` công khai (3 gói từ DB, Tháng/Năm, gói credit lẻ, mua → `/credits/pay/:id`); trang QR poll trạng thái, SUCCEEDED → báo thành công về `/credits`; `/credits` (khả dụng / đang giữ / gói / mua, gói hiện tại + hạn, lịch sử giao dịch tiếng Việt, lịch sử thanh toán); `/profile` (tên, avatar qua `/api/uploads`, đổi mật khẩu).

- [ ] **Step 1: Viết test**: sau grant + hold, `GET /api/credits` → `balance.held` = cost, `transactions[0].type` = `hold`.
- [ ] **Step 2:** FAIL → route → PASS. Viết trang.
- [ ] **Step 3:** Kiểm tay: đơn credit 100, `curl` webhook có chữ ký đúng → trang QR tự sang "Thành công", số dư +100.
- [ ] **Step 4: Commit** `feat(ui): trang credit, thanh toán QR, hồ sơ, bảng giá`

---

### Task 12: Cổng quản trị

**Files:** Create `src/server/services/admin.ts`, `src/app/api/admin/{stats,users,users/[id],users/[id]/credits,models,plans,presets,music,jobs,jobs/[id],payments,payments/[id]/confirm,settings,engines/health}/route.ts`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`, trang `users`, `users/[id]`, `models`, `credit-rules`, `plans`, `presets`, `music`, `jobs`, `payments`, `settings`, `src/components/admin/{DataTable,EntityForm,StatCard,LineChart}.tsx`, `tests/services/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `adminAdjust`, `activatePlan`, `startFree`, `expirePlanCredits`, `cancelJob`, `retryJob`, `fulfillPayment`, `setSetting`, `getMuse().health()`, `checkCli()` (Task 13)
- Produces:
  - `getStats(range: '1d'|'7d'|'30d', now?)` → `{ newUsers, images, videos, assembles, creditsSpent, revenue, usersByPlan, creditsByModel: {modelId, name, credits}[], avgSecondsByModel: {modelId, name, seconds}[], daily: {date, images, videos, assembles, revenue}[] }` (`creditsSpent` = hold của job đã `charge`; `revenue` = Payment SUCCEEDED; `avgSecondsByModel` = trung bình `finishedAt - startedAt` của job SUCCEEDED)
  - `listUsers({ search?, plan?, page })` (20/trang, kèm `planCode`, `available`)
  - `setUserStatus(userId, status, actorId)` (không tự khóa mình → `VALIDATION`)
  - `adminChangePlan(userId, planCode, period)` (`free` → đóng sub, expire credit gói, `startFree`)
  - CRUD model / plan / preset / music track (zod). Model đã có job chỉ tắt, không xóa; plan không xóa.
  - Trang `credit-rules`: sửa `baseCost` từng engine + `voice_line_cost`, bảng xem trước (ảnh × 1/2/4, video 5/10s, ghép 0/3/6 câu) qua `quote`.
  - Trang `jobs`: lọc trạng thái / user / engine; Hủy (PENDING), Chạy lại (FAILED); xem `error`.
  - Trang `payments`: lọc; "Xác nhận" → `fulfillPayment(id, { confirmedBy })`.
  - Trang `settings`: bảo trì, `credit_packs`, `prompt_writer` (provider + model), trạng thái engine `GET /api/admin/engines/health` → `{ muse: {ok, driver, accounts}, agy: {ok, version}, codex: {ok, version}, vieneu: {ok}, ffmpeg: {ok} }`. Phần agy / codex dùng `checkCli()` của Task 13; làm Task 12 trước thì tạm trả `{ ok: false }` cho hai mục này và nối lại ở Task 13.

- [ ] **Step 1: Viết test**: route admin bằng user thường → 403 · `getStats counts` (gồm `creditsByModel`, `avgSecondsByModel`, `daily.revenue`) · `admin cannot lock self` · `adjust credit requires reason` · `disable model hides it from catalog` · `manual confirm fulfills once`.
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3:** Kiểm tay: khóa 1 user → mọi API của user đó trả `ACCOUNT_LOCKED`; bật bảo trì → bấm Tạo báo bảo trì.
- [ ] **Step 4: Commit** `feat(admin): dashboard, user, engine, giá, gói, preset, nhạc, job, thanh toán, cài đặt`

---

## Phần B — AI: viết prompt & tạo ảnh bằng CLI

### Task 13: Chạy CLI an toàn + AI viết prompt

**Files:** Create `src/server/engines/cli.ts`, `src/server/engines/agy.ts` (phần text), `src/server/engines/codex.ts` (phần text), `src/server/engines/prompt-writer.ts`, `src/app/api/ai/prompt/route.ts`, `tests/fixtures/fake-agy.sh`, `tests/fixtures/fake-codex.sh`, `tests/engines/cli.test.ts`, `tests/engines/prompt-writer.test.ts`

**Interfaces:**
- Consumes: `getSetting('prompt_writer')`, `requireUser`
- Produces:
  - `runCli(opts: { bin: string; args: string[]; stdin?: string; env?: Record<string,string>; timeoutMs: number; setup?: (dir: string) => Promise<void>; collect?: (dir: string, stdout: string) => Promise<T>; signal?: AbortSignal }): Promise<{ stdout: string; result: T }>`
    - Tạo `mkdtemp(os.tmpdir(), 'aura-cli-')`, gọi `setup(dir)`, `spawn(bin, args, { cwd: dir, detached: true })`, quá `timeoutMs` hoặc `signal` hủy → `process.kill(-pid, 'SIGKILL')` + `EngineError('TIMEOUT'|'CANCELED', retryable: false)`; mã thoát ≠ 0 → `EngineError('CLI_FAILED')` kèm 300 ký tự cuối stderr; luôn `rm -rf dir` trong `finally` (sau `collect`).
  - `checkCli(): Promise<{ agy: {ok, version?}; codex: {ok, version?} }>` (`--version`, timeout 10 s)
  - `agyText(prompt: string, model: string): Promise<string>`: `setup` tạo `.agy-state/antigravity-cli/` (chép `antigravity-oauth-token`, `installation_id`, `settings.json` từ `${AGY_HOME ?? ~/.gemini/antigravity-cli}`, mode 600) và `.agents/agents/writer.md` (agent `writer`, `tools: []`); chạy `agy --gemini_dir <dir>/.agy-state --app_data_dir antigravity-cli -p <prompt> --model <model> --agent writer --dangerously-skip-permissions --output-format json --print-timeout 120s`; parse JSON giữa `{` đầu và `}` cuối, `status !== 'SUCCESS'` → `EngineError('AGY_FAILED')`, trả `response`.
  - `codexText(prompt: string, effort = 'low'): Promise<string>`: `codex exec --ephemeral --skip-git-repo-check -C <dir> -s read-only -c model_reasoning_effort="<effort>" -o <dir>/last.txt <prompt>`; trả nội dung `last.txt`.
  - `writePrompt(input: { idea: string; kind: 'image'|'video'|'script'; aspect?: string; durationSec?: number }): Promise<{ prompt?: string; lines?: string[] }>`
    - Ghép task tiếng Việt yêu cầu trả JSON: ảnh / video → `{"prompt": "..."}` (tiếng Anh 40–80 từ: chủ thể, bối cảnh, ánh sáng, góc máy, phong cách; video thêm chuyển động camera); `script` → `{"lines": ["...", ...]}` (lời thoại quảng cáo tiếng Việt, 3–6 câu, mỗi câu ≤ 20 chữ, không bịa giá / ưu đãi nếu ý tưởng không có).
    - Gọi theo `prompt_writer` setting (mặc định agy `claude-sonnet-4-6`); lỗi → thử engine còn lại (codex ↔ agy); cả hai lỗi → `EngineError('PROMPT_WRITER')`.
    - Parse JSON từ chuỗi trả về (bỏ ```json nếu có); sai dạng → `EngineError('BAD_OUTPUT')`.
  - `POST /api/ai/prompt` `{ idea, kind, aspect?, durationSec? }` → `writePrompt` (không tốn Credit; tối đa 1 request đang chạy mỗi user, quá → `CONCURRENCY_LIMIT`).
  - Biến môi trường: `AGY_BIN` (mặc định `agy`), `CODEX_BIN` (mặc định `codex`), `AGY_HOME`, `CODEX_HOME`.

- [ ] **Step 1: Viết** `fake-agy.sh` (đọc `-p`, in `{"status":"SUCCESS","response":"{\"prompt\":\"fake prompt\"}"}`; nếu `FAKE_SLEEP` thì `sleep`; nếu `FAKE_FAIL` thì thoát 1) và `fake-codex.sh` (ghi `{"lines":["Câu 1.","Câu 2."]}` vào file sau `-o`).
- [ ] **Step 2: Viết test** `cli.test.ts`: `runCli returns stdout and cleans workdir` (dir không còn sau khi xong) · `runCli kills process group on timeout and removes workdir` (`FAKE_SLEEP=5`, `timeoutMs: 300` → `TIMEOUT`, không còn tiến trình con, dir bị xóa) · `runCli nonzero exit throws CLI_FAILED`.
- [ ] **Step 3: Viết test** `prompt-writer.test.ts` (`AGY_BIN` / `CODEX_BIN` trỏ fake): `image prompt via agy` → `{prompt:'fake prompt'}` · `falls back to codex when agy fails` (`FAKE_FAIL=1`) · `script returns lines` · `bad json throws BAD_OUTPUT`.
- [ ] **Step 4:** FAIL → viết → PASS.
- [ ] **Step 5:** Kiểm tay **(chinhan đồng ý, tốn lượt agy)**: `curl POST /api/ai/prompt {"idea":"chai nước hoa hổ phách","kind":"image","aspect":"9:16"}` → prompt tiếng Anh trong ~8–18 s; `ls -d /tmp/aura-cli-*` trống; số file `~/.gemini/antigravity-cli/conversations` không đổi.
- [ ] **Step 6:** Nối nút "AI viết prompt" trong `PromptBox` (Task 10) và "AI viết lời thoại" (Task 18 dùng lại).
- [ ] **Step 7: Commit** `feat(ai): chạy CLI trong thư mục tạm và AI viết prompt bằng agy/codex`

---

### Task 14: Engine ảnh agy (`generate_image`)

**Files:** Modify `src/server/engines/agy.ts`, `src/server/engines/index.ts`; Create `tests/engines/agy-image.test.ts`; Modify `tests/fixtures/fake-agy.sh`

**Interfaces:**
- Consumes: `runCli`, `FileEngine`, `MediaRequest`
- Produces: `agyImage: FileEngine` (đăng ký `getFileEngine('AGY')`)
  - `setup`: như `agyText` + `.agents/agents/imagegen.md`:
    ```markdown
    ---
    name: imagegen
    description: Draws exactly one image with the generate_image tool and stops.
    tools:
      - generate_image
    excludeDefaultComponents: true
    mainAgent: true
    ---
    Call generate_image exactly once with the user's image prompt and the listed reference images (absolute paths, in the given order). Then reply with the single word done. Never call any other tool, never retry, never review the result.
    ```
    Ảnh tham chiếu (`inputPath`) chép vào `<dir>/ref-1.<ext>`.
  - Prompt: `Generate exactly one image with the generate_image tool, then stop. Do not run commands, read files or retry.\n{refs}\nAspect ratio: {aspect}.\n\nIMAGE PROMPT:\n{prompt}` với `{refs}` = `Reference image 1 = <đường dẫn tuyệt đối ref-1>` hoặc `Use no reference images.`
  - Lệnh: `agy --gemini_dir … --app_data_dir antigravity-cli -p <prompt> --model <engineModel> --agent imagegen --dangerously-skip-permissions --output-format json --print-timeout 480s`; `timeoutMs` 510 000.
  - `collect`: ảnh mới nhất (`.png|.jpg|.jpeg|.webp`, mtime ≥ lúc bắt đầu) trong `<dir>/.agy-state/antigravity-cli/brain/**` hoặc `<dir>` (trừ `ref-*`) → chép ra `os.tmpdir()/aura-out-<uuid>.<ext>` trước khi `runCli` xóa thư mục; trả `{ files: [đường dẫn đó] }`. Không có ảnh → `EngineError('NO_IMAGE')` kèm câu agy trả (từ chối nội dung thì code `REFUSED`, khi `response` chứa "can't"/"cannot"/"không thể").
  - `finishJob` xóa file `aura-out-*` sau khi `putFile`.

- [ ] **Step 1:** Mở rộng `fake-agy.sh`: khi `--agent imagegen` thì chép `tests/fixtures/sample.png` vào `$GEMINI_DIR/antigravity-cli/brain/conv1/image_1.png` (lấy từ tham số `--gemini_dir`), in `{"status":"SUCCESS","response":"done"}`; `FAKE_NO_IMAGE=1` thì không chép, response `"I cannot generate this"`.
- [ ] **Step 2: Viết test**: `agyImage returns file copied out of brain` (file tồn tại sau khi workdir đã xóa) · `agyImage copies reference image as ref-1` (fake ghi lại tham số `-p`, kiểm có đường dẫn tuyệt đối `ref-1`) · `agyImage refused` → `REFUSED`.
- [ ] **Step 3:** FAIL → viết → PASS.
- [ ] **Step 4:** Kiểm tay **(chinhan đồng ý)**: tạo 1 ảnh Gemini 9:16 qua UI → SUCCEEDED trong 1,5–4 phút, ảnh đúng tỷ lệ; `/tmp/aura-cli-*` trống.
- [ ] **Step 5: Commit** `feat(engine): tạo ảnh bằng agy generate_image`

---

### Task 15: Engine ảnh codex

**Files:** Modify `src/server/engines/codex.ts`, `src/server/engines/index.ts`; Create `tests/engines/codex-image.test.ts`; Modify `tests/fixtures/fake-codex.sh`

**Interfaces:**
- Consumes: `runCli`, `FileEngine`
- Produces: `codexImage: FileEngine` (đăng ký `getFileEngine('CODEX')`)
  - `home = CODEX_HOME ?? ~/.codex` (đã `codex login`, cần gói ChatGPT Plus để có công cụ ảnh).
  - Lệnh: `codex exec --skip-git-repo-check -C <dir> -s workspace-write --json [-m engineModel] [-i <dir>/ref-1.<ext>]`, prompt qua **stdin** (`-i` nuốt tham số phía sau): `Use your built-in image generation tool exactly ONCE to create one image, then stop.\nRules: do not run shell commands, do not create, edit or save any files, do not ask questions.\n{refs}\nAspect ratio: {aspect}.\n\nImage prompt:\n{prompt}`; `timeoutMs` 600 000.
  - `collect`: đọc dòng JSON stdout; `thread.started` → `thread_id`; `error` / `turn.failed` → gom lỗi; `agent_message` cuối → câu trả lời. Ảnh mới nhất trong `${home}/generated_images/${thread_id}/` (thread_id khớp `^[\w-]+$`) → chép ra `os.tmpdir()/aura-out-<uuid>.<ext>`.
  - **Dọn phiên**: luôn xóa `${home}/generated_images/${thread_id}/` và file `${home}/sessions/**/rollout-*${thread_id}*.jsonl` sau khi chép ảnh (kể cả khi lỗi).
  - Không có ảnh: lỗi chứa "rate limit"/"usage limit" → `EngineError('QUOTA', retryable: false)`; "not available"/"image generation" → `NO_IMAGE_TOOL`; còn lại `NO_IMAGE`.

- [ ] **Step 1:** Mở rộng `fake-codex.sh`: khi không có `-o` (chế độ ảnh) in `{"type":"thread.started","thread_id":"t123"}`, chép `sample.png` vào `$CODEX_HOME/generated_images/t123/img.png`, tạo `$CODEX_HOME/sessions/2026/11/06/rollout-x-t123.jsonl`, in `{"type":"item.completed","item":{"type":"agent_message","text":"done"}}`; `FAKE_QUOTA=1` in `{"type":"error","message":"You've hit your usage limit"}`.
- [ ] **Step 2: Viết test** (`CODEX_HOME` = thư mục tạm): `codexImage returns image and cleans thread files` (ảnh trả về tồn tại; `generated_images/t123` và rollout `t123` đã bị xóa) · `codexImage quota error` → `QUOTA` · `prompt sent via stdin`.
- [ ] **Step 3:** FAIL → viết → PASS.
- [ ] **Step 4:** Kiểm tay **(chinhan đồng ý)**: tạo 1 ảnh Codex bằng tài khoản Pro → SUCCEEDED trong ~3 phút; `~/.codex/sessions` không thêm file.
- [ ] **Step 5: Commit** `feat(engine): tạo ảnh bằng codex, dọn phiên sau khi xong`

---

## Phần C — Giọng đọc & ghép video

### Task 16: Giọng VieNeu (danh sách, nghe thử)

**Files:** Create `src/server/engines/voice.ts`, `src/app/api/voices/route.ts`, `src/app/api/voices/preview/route.ts`, `tests/fixtures/fake-vieneu-say.sh`, `tests/engines/voice.test.ts`

**Interfaces:**
- Consumes: `runCli`, `putFile`, `requireUser`, `getActivePlan`
- Produces:
  - `listVoices(): Promise<{ id: string; name: string; gender: string; region: string; style: string }[]>`: `vieneu-say --list`, parse dòng dạng `⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên` (`id` = tên không có `⭐`), cache trong bộ nhớ 1 giờ.
  - `previewVoice(voice: { preset?: string; refPath?: string }): Promise<string>`: câu mẫu cố định "Xin chào, đây là giọng đọc mẫu cho video của bạn." → `vieneu-say … -o <dir>/p.wav` → `putFile` vào `previews/{sha1(voice)}.wav`, có rồi thì trả luôn (cache theo key); `timeoutMs` 180 000.
  - `GET /api/voices` → `listVoices()`; `POST /api/voices/preview` `{ preset } | { refUrl }` (clone cần gói Pro → `PLAN_MODEL`; `refUrl` phải là upload của chính user) → `{ url }`.
  - Biến môi trường `VIENEU_BIN` (mặc định `vieneu-say`).

- [ ] **Step 1:** `fake-vieneu-say.sh`: `--list` in 3 dòng mẫu; có `-o` thì `ffmpeg -f lavfi -i sine=f=440:d=1` ra file đó; có `--segments` thì ghi JSON mốc giờ 1 s mỗi dòng.
- [ ] **Step 2: Viết test**: `listVoices parses names` (`Trúc Ly`, `Nữ`, `Bắc`) · `previewVoice caches by key` (gọi 2 lần, fake chỉ chạy 1 lần) · `preview clone requires pro`.
- [ ] **Step 3:** FAIL → viết → PASS.
- [ ] **Step 4:** Kiểm tay với `vieneu-say` thật: `GET /api/voices` trả 25 giọng; nghe thử "Trúc Ly" ra file wav (~10–40 s trên CPU).
- [ ] **Step 5: Commit** `feat(voice): danh sách giọng VieNeu và nghe thử`

---

### Task 17: Engine ghép video

**Files:** Create `src/server/engines/assemble.ts`, `worker/processors/assemble.ts`, `tests/engines/assemble.test.ts`; Modify `tools/post/assemble.py` (đọc `VIENEU_BIN`)

**Interfaces:**
- Consumes: `runCli`, `storagePath`, `putFile`, `finishJob`, `failJob`, `tools/post/assemble.py` (spec trong [post-production.md](../../post-production.md))
- Produces:
  - `buildAssembleSpec(params: AssembleParams, clipFiles: { path: string; kind: 'image'|'video' }[], musicPath: string | null, refPath: string | null, out: string): object` — map sang spec của `assemble.py`: `aspect`; mỗi clip → `{type:'image', src, duration: clip.duration ?? 3}` hoặc `{type:'video', src, in, out}`; `clip_audio_db` = `keepClipAudio ? -6 : null`; `voice` = `lines.length ? { lines, voice: preset } | { lines, ref: refPath } : undefined`; `music` = `{ src: musicPath, volume_db: -14 }`; `subtitles`.
  - `runAssemble(spec: object): Promise<{ output: string; duration: number }>`: ghi spec vào `<dir>/spec.json` (thư mục tạm của `runCli`), chạy `python3 tools/post/assemble.py <dir>/spec.json` (`ASSEMBLE_PY` mặc định `python3`), out = `os.tmpdir()/aura-out-<uuid>.mp4`, `timeoutMs` 1 200 000; stdout có `error` → `EngineError('ASSEMBLE_FAILED')`.
  - `processAssemble(job: Job)`: đọc `params`; với mỗi `clips[i].jobId` lấy job SUCCEEDED **của cùng user** (khác user / chưa xong / đã xóa → `failJob('BAD_CLIP')`), lấy file `resultUrls[index ?? 0]` qua `storagePath`; nhạc từ setting `music_tracks` → `public/...`; `voice.refUrl` → `storagePath`; `runAssemble` → `finishJob([{ path: output }])`.
  - `assemble.py`: lệnh giọng dùng `os.environ.get('VIENEU_BIN') or shutil.which('vieneu-say')`.

- [ ] **Step 1: Viết test** `assemble.test.ts` (`VIENEU_BIN` trỏ fake, ffmpeg thật, fixture `sample.png` + `sample.mp4` 2 s):
  - `buildAssembleSpec maps clips voice music` (so object mong đợi)
  - `runAssemble produces mp4` (2 clip + 2 câu + nhạc trong `public/music` → file mp4, `ffprobe` thời lượng ≥ 4 s, có track audio)
  - `processAssemble fails on foreign clip` → job FAILED `BAD_CLIP`, credit hoàn
- [ ] **Step 2:** FAIL → viết → PASS.
- [ ] **Step 3: Commit** `feat(post): engine ghép video gọi assemble.py`

---

### Task 18: UI Ghép video

**Files:** Create `src/app/(user)/studio/edit/page.tsx`, `src/components/studio/{ClipPicker,ClipTimeline,ScriptEditor,VoicePicker,MusicPicker}.tsx`, `tests/api/assemble-job.test.ts`

**Interfaces:**
- Consumes: `GET /api/jobs?kind&status=SUCCEEDED`, `GET /api/catalog?kind=assemble` (model Ghép + `music`), `GET /api/voices`, `POST /api/voices/preview`, `POST /api/uploads` (`kind=audio`), `POST /api/ai/prompt` (`kind: 'script'`), `POST /api/jobs/quote`, `POST /api/jobs` (`kind: 'assemble'`)
- Hành vi:
  - `ClipPicker`: lưới ảnh / video đã xong của user; bấm để thêm vào `ClipTimeline` (kéo thả đổi thứ tự, xóa; ảnh có ô số giây 1–10, mặc định 3; video có ô in / out).
  - Tỷ lệ khung 9:16 / 16:9 / 1:1.
  - `ScriptEditor`: textarea mỗi dòng 1 câu (tối đa 20 dòng, 200 ký tự/dòng); nút "AI viết lời thoại" (ô mô tả sản phẩm → `writePrompt(kind:'script')` → điền các dòng).
  - `VoicePicker`: danh sách giọng (lọc Nam / Nữ, miền), nút nghe thử; tab "Giọng của tôi" (gói Pro): upload audio 3–8 giây → nghe thử bản clone.
  - `MusicPicker`: không nhạc / các bài trong `music_tracks`, nghe thử.
  - Công tắc: Phụ đề (mặc định bật), Giữ tiếng gốc clip (mặc định tắt).
  - Nút `Ghép video · {cost} Credit` (quote theo số câu). Kết quả vào Thư viện tab "Video ghép"; Tạo lại mở lại trang với đủ thiết lập.

- [ ] **Step 1: Viết test** `assemble-job.test.ts`: `POST /api/jobs` kind assemble 3 câu → job PENDING cost 5, vào hàng đợi `post` · `assemble rejects foreign job` (clip là job của user khác hoặc chưa SUCCEEDED → `VALIDATION` ngay khi tạo) · `assemble rejects foreign voice ref` (`voice.refUrl` không thuộc `uploads/{userId}/`) · Free + `voice.refUrl` → `PLAN_MODEL`.
- [ ] **Step 2:** FAIL → trong `createJob` (Task 8), với kind assemble: truy vấn các `clips[].jobId` phải SUCCEEDED, chưa xóa, cùng `userId`; `voice.refUrl` phải có tiền tố `/media/uploads/{userId}/` → PASS. Viết trang, component.
- [ ] **Step 3:** Kiểm tay (mock MUSE + VieNeu thật): ghép 1 ảnh + 1 video + 3 câu Trúc Ly + nhạc → Thư viện có MP4 1080×1920 có giọng, nhạc, phụ đề trong vài phút.
- [ ] **Step 4: Commit** `feat(ui): trang ghép video với giọng, nhạc, phụ đề`

---

## Phần D — Chạy trên máy & nghiệm thu

### Task 19: Script chạy, tài liệu, nghiệm thu E2E

**Files:** Create `scripts/start-all.sh`; Modify `README.md`, `.env.example`

**Interfaces:**
- Produces `scripts/start-all.sh`: `docker compose up -d` → chạy muse2api (`MUSE2API_DIR`, driver theo `.env`) nền → `npx prisma migrate deploy` → `npm run build && npm start` + `npm run worker` (log vào `data/logs/`); `Ctrl+C` dừng hết.

- [ ] **Step 1:** README: yêu cầu máy (Node 20+, Python 3.12, Docker, ffmpeg, Chromium), cài muse2api (clone + venv + import cookie qua dashboard / extension), đăng nhập `agy` và `codex login`, cài VieNeu ([voice-vieneu.md](../../voice-vieneu.md)), `.env`, `npm run db:seed`, `scripts/start-all.sh`, cron `scripts/muse-keepalive.sh` mỗi 30 phút.
- [ ] **Step 2:** `.env.example` đủ biến: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `GOOGLE_*`, `STORAGE_DIR`, `MUSE_API_URL`, `MUSE_API_KEY`, `MUSE_CONCURRENCY`, `CLI_CONCURRENCY`, `AGY_BIN`, `AGY_HOME`, `CODEX_BIN`, `CODEX_HOME`, `VIENEU_BIN`, `ASSEMBLE_PY`, `BANK_*`, `PAYMENT_WEBHOOK_SECRET`, `SMTP_*`, `SEED_ADMIN_*`.
- [ ] **Step 3:** `npm test` xanh toàn bộ, `npm run build` OK.
- [ ] **Step 4: Nghiệm thu với muse2api mock + fake CLI** (agent tự chạy): đăng ký → AI viết prompt (fake) → ảnh MUSE + ảnh agy (fake) + video MUSE → mua Pro qua webhook giả → video 10s → ghép video 3 câu (VieNeu thật) → admin thấy số liệu.
- [ ] **Step 5: Nghiệm thu thật** (**chinhan bấm**, tốn lượt): cùng luồng với muse2api driver `browser`, agy, codex thật; ghi thời gian từng bước vào README.
- [ ] **Step 6: Commit** `docs: hướng dẫn chạy trên 1 máy và script start-all`
