# AuraMotion Core Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng bộ xương nghiệp vụ chạy được end-to-end: tài khoản → gói → Credit (giữ/trừ/hoàn) → tạo job ảnh/video qua **FakeMuse** → thư viện → thanh toán QR → cổng Admin.

**Architecture:** 1 app Next.js (trang + API routes) + 1 worker BullMQ. Mọi logic nghiệp vụ nằm trong `src/server/services`, route chỉ parse input (zod) rồi gọi service. MUSE được gọi qua interface `MuseClient`; giai đoạn này dùng `FakeMuse` trả file mẫu, sau này thay bằng client thật mà không phải sửa service.

**Tech Stack:** Next.js 15 (App Router, TypeScript), Prisma + PostgreSQL 16, Redis 7 + BullMQ, Auth.js v5 (Credentials + Google), zod, bcryptjs, @aws-sdk/client-s3 (MinIO khi dev, R2 khi prod), nodemailer, Tailwind + shadcn/ui, Vitest.

**Spec:** [`docs/plan.md`](../../plan.md), [`docs/architecture.md`](../../architecture.md)

## Ngoài phạm vi (làm sau)
- Tích hợp MUSE thật (chỉ có interface + FakeMuse).
- Lồng tiếng TTS, phụ đề, upscale, khung đầu/cuối, inpaint, hậu kỳ, watermark.
- Cộng đồng, Character ID, API cho bên ngoài.

## Global Constraints
- Credit lưu `Decimal(12,2)`, làm tròn HALF_UP về 2 chữ số sau mỗi phép tính giá.
- Số dư = tổng `credit_transactions.amount`. Không có cột số dư nào trên `users`.
- Loại giao dịch: `grant`, `purchase`, `hold`, `charge`, `refund`, `admin_adjust`, `expire`.
- Gói seed: Free 20 credit / 1 job cùng lúc / 720p · Pro 500 / 3 / 1080p · Ultra 2000 / 6 / 4K. Giá Pro, Ultra để trong DB, Admin chỉnh.
- Credit của gói không cộng dồn sang kỳ sau. Credit mua thêm thì không hết hạn. Khi tiêu thì trừ credit gói trước.
- Tỷ lệ khung: ảnh `1:1, 9:16, 16:9, 4:5`; video `9:16, 16:9, 1:1`. Số ảnh mỗi lần: `1, 2, 4`. Thời lượng video: `5, 10` giây.
- Hệ số độ phân giải (setting `resolution_multipliers`): ảnh `{"1k":1,"4k":2}`, video `{"720p":1,"1080p":1.7,"4k":3.75}`.
- Gói Credit lẻ (setting `credit_packs`): 100 / 500 / 1000 credit, giá do Admin nhập.
- Kết quả của gói Free giữ 30 ngày. Gửi email nhắc gia hạn 3 ngày trước khi gói hết hạn.
- Ưu tiên hàng đợi theo BullMQ `priority`: ultra 1, pro 5, free 10.
- Job treo quá 15 phút ở trạng thái `pending`/`running` → `failed` (`TIMEOUT`) và hoàn Credit.
- Code (tên biến, hàm) viết tiếng Anh. Chữ hiển thị cho người dùng viết tiếng Việt.

## Review Focus
1. **Bấm Tạo hai lần liên tiếp:** hai request giữ Credit cùng lúc không được làm số dư âm. Test `hold is serialized per user` (Task 3).
2. **Worker chết giữa chừng:** Credit đang giữ phải được hoàn bởi sweeper. Test `sweepStuckJobs refunds timed-out jobs` (Task 8).
3. **Webhook gửi lặp hoặc sai số tiền:** không được cộng gói hay Credit hai lần, không kích hoạt khi chuyển thiếu. Test `webhook is idempotent` và `underpaid webhook does not fulfill` (Task 9).
4. **Gọi API vượt giới hạn gói:** gói Free gửi `resolution=4k` hoặc model Pro thẳng qua API phải bị từ chối ở server. Test `rejects resolution above plan` (Task 4).
5. **Tài khoản bị khóa vẫn còn session:** mọi request sau khi khóa phải bị chặn. Test `requireUser rejects locked user` (Task 6).

---

## File Structure

```
docker-compose.yml                    postgres, redis, minio
vitest.config.ts
.env.example                          (sửa) thêm biến BANK_*, SMTP_*, FAKE_MUSE_*
prisma/schema.prisma
prisma/seed.ts
public/samples/sample.jpg, sample.mp4 file mẫu cho FakeMuse
src/lib/db.ts                         Prisma client singleton
src/lib/redis.ts                      ioredis connection
src/lib/queue.ts                      BullMQ queue "generation"
src/lib/storage.ts                    S3/R2: presign, putFromUrl, delete
src/lib/mail.ts                       sendMail (console khi thiếu SMTP)
src/lib/errors.ts                     AppError + mã lỗi
src/lib/http.ts                       handle(): AppError → JSON response
src/lib/auth.ts                       Auth.js config, requireUser, requireAdmin
src/middleware.ts                     chặn route theo đăng nhập/role
src/server/services/credit.ts
src/server/services/pricing.ts
src/server/services/plan.ts
src/server/services/settings.ts
src/server/services/account.ts
src/server/services/job.ts
src/server/services/payment.ts
src/server/services/admin.ts
src/server/muse/types.ts              MuseClient, MuseRequest, MuseResult, MuseError
src/server/muse/fake.ts               FakeMuse
src/server/muse/index.ts              getMuseClient()
src/app/api/**/route.ts               route mỏng, gọi service
src/app/(auth)/**, (user)/**, pricing, admin/**   trang
src/components/**                     UI
worker/index.ts                       khởi động Worker + lịch cron
worker/processors/generate.ts         processJob
worker/cron/index.ts                  renew, expire, remind, sweep, cleanup
tests/helpers/db.ts                   resetDb(), createUser(), seedBase()
tests/services/*.test.ts
tests/api/*.test.ts
```

---

### Task 1: Khởi tạo dự án & hạ tầng dev

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`, `vitest.config.ts`, `src/lib/db.ts`, `src/lib/redis.ts`, `src/lib/errors.ts`, `src/lib/http.ts`, `tests/helpers/db.ts`, `tests/smoke.test.ts`, `.env.test`
- Modify: `.env.example`, `.gitignore`
- Xóa các `.gitkeep` ở thư mục nào đã có file thật.

**Interfaces:**
- Produces:
  - `db: PrismaClient` (`src/lib/db.ts`)
  - `redis: IORedis` (`src/lib/redis.ts`)
  - `class AppError extends Error { code: ErrorCode; status: number }`, `type ErrorCode = 'UNAUTHORIZED'|'FORBIDDEN'|'NOT_FOUND'|'VALIDATION'|'INSUFFICIENT_CREDIT'|'CONCURRENCY_LIMIT'|'PLAN_RESOLUTION'|'PLAN_MODEL'|'MAINTENANCE'|'ACCOUNT_LOCKED'|'CONFLICT'`
  - `handle(fn: () => Promise<unknown>): Promise<Response>`: trả 200 JSON; AppError → `{error:{code,message}}` với `status`; ZodError → 400 `VALIDATION`.
  - `resetDb(): Promise<void>`: TRUNCATE mọi bảng (CASCADE).

- [ ] **Step 1:** `npx create-next-app@15 . --ts --tailwind --app --src-dir --import-alias "@/*" --no-eslint`, cài `prisma @prisma/client bullmq ioredis zod bcryptjs next-auth@5 @aws-sdk/client-s3 @aws-sdk/s3-request-presigner nodemailer` và dev deps `vitest @types/bcryptjs @types/nodemailer tsx`. Thêm script: `dev`, `worker` (`tsx worker/index.ts`), `test` (`vitest run`), `db:migrate`, `db:seed`.
- [ ] **Step 2:** `docker-compose.yml`: postgres:16 (5432), redis:7 (6379), minio (9000/9001, bucket `auramotion`). `.env.test` trỏ tới DB `auramotion_test`.
- [ ] **Step 3: Viết test** `tests/smoke.test.ts`: `handle(() => { throw new AppError('NOT_FOUND', 'x', 404) })` trả status 404, body `{error:{code:'NOT_FOUND',message:'x'}}`.
- [ ] **Step 4:** Chạy `npm test`. Kết quả mong đợi: FAIL (chưa có module).
- [ ] **Step 5:** Viết `errors.ts`, `http.ts`, `db.ts`, `redis.ts`.
- [ ] **Step 6:** Chạy `docker compose up -d && npm test && npm run build`. Kết quả mong đợi: PASS, build OK.
- [ ] **Step 7: Commit** `chore: khởi tạo Next.js, Prisma, Vitest, docker-compose`

---

### Task 2: Schema & seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `src/server/services/settings.ts`, `tests/services/seed.test.ts`

**Interfaces:**
- Produces các model Prisma sau (tên trường dùng xuyên suốt plan):
  - `User { id, email @unique, passwordHash?, googleId? @unique, name, avatarUrl?, role: USER|ADMIN, status: ACTIVE|LOCKED, createdAt }`
  - `PasswordResetToken { id, userId, tokenHash @unique, expiresAt, usedAt? }`
  - `Plan { id, code @unique: free|pro|ultra, name, priceMonth Int, priceYear Int, monthlyCredits Decimal, maxConcurrent Int, maxResolution String, rank Int }` (rank: free 0, pro 1, ultra 2; giá tính bằng VND)
  - `Subscription { id, userId, planId, period: MONTH|YEAR, startAt, endAt?, nextGrantAt, status: ACTIVE|EXPIRED|CANCELED, remindedAt? }` (Free: `endAt = null`)
  - `CreditTransaction { id, userId, type, bucket: PLAN|PURCHASED, amount Decimal(12,2), jobId?, paymentId?, actorId?, note?, createdAt }`, index `(userId)`, `(jobId)`
  - `AiModel { id, name, museModelId, kind: IMAGE|VIDEO, minPlanRank Int, baseCost Decimal, options Json, enabled Boolean, sort Int }`. `options = { aspectRatios: string[], resolutions: string[], durations?: number[], audio?: boolean }`
  - `Preset { id, kind: STYLE|CAMERA, name, promptSuffix, thumbnailUrl?, enabled }`
  - `Job { id, userId, modelId, kind, prompt, params Json, inputUrl?, status: PENDING|RUNNING|SUCCEEDED|FAILED|CANCELED, cost Decimal, resultUrls String[], error?, createdAt, startedAt?, finishedAt?, deletedAt?, expiresAt? }`
  - `Payment { id, userId, type: PLAN|CREDIT, planCode?, period?, creditAmount Decimal?, amount Int, refCode @unique, status: PENDING|SUCCEEDED|CANCELED, providerTxnId? @unique, paidAt?, confirmedBy?, createdAt }`
  - `Setting { key @id, value Json }`
- Produces `getSetting<T>(key: string): Promise<T>`, `setSetting(key: string, value: unknown): Promise<void>` (`settings.ts`).
- Ghi chú so với spec: thêm `bucket` và loại `expire` vào `credit_transactions` để làm đúng luật "credit gói không cộng dồn"; thêm `nextGrantAt` để gói năm vẫn được cấp credit hằng tháng.

- [ ] **Step 1: Viết test** `seed.test.ts`: sau khi chạy `seed()`:
  ```ts
  expect(await db.plan.count()).toBe(3)
  expect((await db.plan.findUnique({where:{code:'pro'}}))!.monthlyCredits.toNumber()).toBe(500)
  expect(await getSetting('resolution_multipliers')).toEqual({image:{'1k':1,'4k':2},video:{'720p':1,'1080p':1.7,'4k':3.75}})
  expect(await db.aiModel.count({where:{enabled:true}})).toBe(4)
  expect(await db.user.count({where:{role:'ADMIN'}})).toBe(1)
  ```
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết schema và `seed.ts` (export `seed()`, chạy lại nhiều lần không sinh trùng nhờ upsert). Seed gồm:
  - 3 gói.
  - 4 model, giá gốc lấy theo bảng 1.2 của spec:

    | Model | kind | minPlanRank | baseCost |
    |---|---|---|---|
    | MUSE Image | IMAGE | 0 | 1 |
    | MUSE Image Pro | IMAGE | 1 | 2 |
    | MUSE Video | VIDEO | 0 | 3 |
    | MUSE Video Pro | VIDEO | 1 | 8 |

  - Preset style: Studio, Ngoài trời, Trên tay, Lifestyle. Preset camera: Zoom In, Zoom Out, Pan trái, Pan phải, Xoay 360, Tĩnh.
  - Settings: `resolution_multipliers`, `credit_packs` (`[{credits:100,price:...},…]`), `maintenance: false`.
  - 1 admin, email và mật khẩu lấy từ `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`.
- [ ] **Step 4:** Chạy `npx prisma migrate dev --name init && npm test`. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(db): schema và seed gói, model, preset`

---

### Task 3: Sổ Credit (ledger)

**Files:**
- Create: `src/server/services/credit.ts`, `tests/services/credit.test.ts`

**Interfaces:**
- Consumes: `db`, `AppError`
- Produces:
  - `type Tx = Prisma.TransactionClient`
  - `getBalance(userId: string, tx?: Tx): Promise<{ available: Decimal; plan: Decimal; purchased: Decimal; held: Decimal }>`
  - `grant(userId: string, amount: Decimal.Value, opts: { type: 'grant'|'purchase'; paymentId?: string; note?: string }, tx?: Tx): Promise<void>`. `grant` vào bucket PLAN, `purchase` vào bucket PURCHASED.
  - `expirePlanCredits(userId: string, tx?: Tx): Promise<void>`: ghi `expire` với số âm bằng số dư PLAN hiện có (bỏ qua nếu ≤ 0).
  - `hold(tx: Tx, userId: string, jobId: string, amount: Decimal.Value): Promise<void>`
  - `charge(jobId: string, tx?: Tx): Promise<void>`
  - `refund(jobId: string, tx?: Tx): Promise<void>`
  - `adminAdjust(userId: string, amount: Decimal.Value, actorId: string, reason: string): Promise<void>`
- Quy ước:
  - `hold` ghi số âm, trừ bucket PLAN trước rồi tới PURCHASED, nên có thể ra 1 hoặc 2 dòng.
  - `charge` ghi 1 dòng `amount = 0`, chỉ để đánh dấu job đã chốt.
  - `refund` ghi số dương, trả về đúng bucket đã giữ.
  - `held` = tổng các hold của những job chưa có `charge` hay `refund`.
  - `charge` và `refund` gọi lại không làm gì (idempotent); gọi `refund` sau `charge` cũng không làm gì.
  - `adminAdjust` vào bucket PURCHASED. `reason` rỗng thì báo `VALIDATION`. Trừ quá số dư thì báo `INSUFFICIENT_CREDIT`.
  - `hold` khóa dòng user bằng `SELECT id FROM "User" WHERE id = $1 FOR UPDATE` trước khi đọc số dư.

- [ ] **Step 1: Viết test** `credit.test.ts`:
  - `grant then balance`: grant 20 → `available` = 20, `plan` = 20.
  - `hold takes plan bucket first`: plan 5 + purchased 10, hold 8 → `plan` = 0, `purchased` = 7, `held` = 8.
  - `hold insufficient`: available 2, hold 3 → reject với code `INSUFFICIENT_CREDIT`.
  - `charge is idempotent`: hold 3, charge, charge → `available` giảm đúng 3, `held` = 0.
  - `refund returns to same buckets`: hold 8 (5 plan + 3 purchased), refund → `plan` = 5, `purchased` = 10.
  - `refund after charge is no-op`.
  - `hold is serialized per user`: available 5, chạy `Promise.allSettled` 2 hold mỗi cái 3 → đúng 1 fulfilled, 1 rejected, `available` = 2.
  - `expirePlanCredits keeps purchased`: plan 7 + purchased 4 → `plan` = 0, `purchased` = 4.
  - `adminAdjust requires reason`.
- [ ] **Step 2:** Chạy `npx vitest run tests/services/credit.test.ts`. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết `credit.ts`.
- [ ] **Step 4:** Chạy lại. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(credit): sổ giao dịch giữ/trừ/hoàn theo bucket`

---

### Task 4: Báo giá & kiểm tra tham số

**Files:**
- Create: `src/server/services/pricing.ts`, `tests/services/pricing.test.ts`

**Interfaces:**
- Consumes: `getSetting`, `AiModel`, `Plan`
- Produces:
  - `generationParamsSchema`: zod schema cho
    ```ts
    type GenerationParams = {
      kind: 'image'|'video'; modelId: string; prompt: string /*1..2000*/;
      aspectRatio: string; resolution: string;
      imageCount?: 1|2|4; durationSec?: 5|10; withAudio?: boolean;
      presetId?: string; inputUrl?: string;
    }
    ```
  - `validateParams(p: GenerationParams, model: AiModel, plan: Plan): void`
  - `quote(p: GenerationParams, model: AiModel): Promise<Decimal>`
- Luật:
  - `validateParams`:
    - `model.kind` khác `p.kind`, hoặc `aspectRatio`/`resolution`/`durationSec` không nằm trong `model.options` → `VALIDATION`.
    - `model.minPlanRank > plan.rank` → `PLAN_MODEL`.
    - Độ phân giải vượt `plan.maxResolution` → `PLAN_RESOLUTION`. Thứ tự so sánh: `720p < 1k ≈ 1080p < 4k`. Free có `maxResolution = 720p` nên ảnh `1k` vẫn được.
  - `quote` = `baseCost × multiplier[kind][resolution] × (image ? imageCount : durationSec / 5)`, làm tròn 2 chữ số.

- [ ] **Step 1: Viết test** `pricing.test.ts`:
  - Ảnh MUSE Image 1k × 1 = `1.00`.
  - Ảnh MUSE Image Pro 4k × 1 = `4.00`.
  - Ảnh MUSE Image 1k × 4 = `4.00`.
  - Video MUSE Video 5s 720p = `3.00`.
  - Video MUSE Video Pro 5s 4k = `30.00`.
  - Video MUSE Video 10s 1080p = `10.20`.
  - `rejects resolution above plan`: gói Free, video 1080p → `PLAN_RESOLUTION`.
  - `rejects model above plan`: gói Free dùng MUSE Video Pro → `PLAN_MODEL`.
  - Ảnh với tỷ lệ `21:9` → `VALIDATION`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết `pricing.ts`.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(pricing): báo giá credit và giới hạn theo gói`

---

### Task 5: Gói & thuê bao

**Files:**
- Create: `src/server/services/plan.ts`, `src/lib/mail.ts`, `tests/services/plan.test.ts`

**Interfaces:**
- Consumes: `grant`, `expirePlanCredits`, `sendMail`
- Produces:
  - `getActivePlan(userId: string): Promise<{ plan: Plan; subscription: Subscription }>`
  - `startFree(userId: string, tx?: Tx, now?: Date): Promise<void>`: tạo sub Free (`nextGrantAt = now + 1 tháng`), grant `monthlyCredits` của Free.
  - `activatePlan(userId: string, planCode: 'pro'|'ultra', period: 'MONTH'|'YEAR', now?: Date, tx?: Tx): Promise<Subscription>`
  - `runMonthlyGrants(now: Date): Promise<number>`: các sub ACTIVE có `nextGrantAt ≤ now` → expirePlanCredits, grant, `nextGrantAt += 1 tháng`.
  - `expireSubscriptions(now: Date): Promise<number>`: sub trả phí có `endAt ≤ now` → EXPIRED, expirePlanCredits, startFree.
  - `sendRenewalReminders(now: Date): Promise<number>`: sub có `endAt` trong 3 ngày tới và `remindedAt = null` → gửi mail, set `remindedAt`.
  - `sendMail(to: string, subject: string, html: string): Promise<void>`: thiếu `SMTP_HOST` thì `console.info`.
- Luật `activatePlan`:
  - Đóng sub ACTIVE cũ (CANCELED), expirePlanCredits, tạo sub mới, `endAt = now + 1 tháng` hoặc `+ 1 năm`, `nextGrantAt = now + 1 tháng`, grant `monthlyCredits`.
  - Mua lại đúng gói đang có thì gia hạn: `endAt` cộng thêm từ `endAt` cũ, không cấp thêm credit.

- [ ] **Step 1: Viết test** `plan.test.ts`:
  - `startFree grants 20`.
  - `activatePlan pro replaces free credits`: Free còn 12 credit + purchased 5 → sau `activatePlan('pro')` có `plan` = 500, `purchased` = 5.
  - `yearly plan grants monthly`: Ultra năm, `runMonthlyGrants(now + 1 tháng)` → `plan` = 2000, và `endAt` vẫn là `now + 1 năm`.
  - `expire falls back to free`: Pro tháng, `expireSubscriptions(now + 1 tháng + 1 giây)` → plan code `free`, `plan` = 20.
  - `renewal reminder sent once`: `sendRenewalReminders` gọi 2 lần → `sendMail` được gọi 1 lần.
  - `renew same plan extends endAt`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết `plan.ts`, `mail.ts`.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(plan): thuê bao, cấp credit theo kỳ, hết hạn về Free`

---

### Task 6: Xác thực & tài khoản

**Files:**
- Create: `src/lib/auth.ts`, `src/middleware.ts`, `src/server/services/account.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/auth/forgot-password/route.ts`, `src/app/api/auth/reset-password/route.ts`, `src/app/api/me/route.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`, `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`, `tests/services/account.test.ts`

**Interfaces:**
- Consumes: `startFree`, `sendMail`
- Produces:
  - `registerUser(input: { email: string; password: string /*min 8*/; name: string }): Promise<User>`: email chuyển về lowercase, trùng email → `CONFLICT`. Chạy trong 1 transaction: tạo user + `startFree`.
  - `verifyCredentials(email: string, password: string): Promise<User | null>`
  - `upsertGoogleUser(profile: { googleId: string; email: string; name: string; avatarUrl?: string }): Promise<User>`: khớp theo googleId, không có thì theo email (gắn googleId), không có nữa thì tạo mới + `startFree`.
  - `requestPasswordReset(email: string): Promise<void>`: luôn trả về OK kể cả email không tồn tại. Token 32 byte, lưu sha256, hết hạn sau 1 giờ, gửi link `${APP_URL}/reset-password?token=`.
  - `resetPassword(token: string, newPassword: string): Promise<void>`: token sai, hết hạn hoặc đã dùng → `VALIDATION`.
  - `updateProfile(userId, { name?, avatarUrl? })`, `changePassword(userId, oldPw, newPw)`.
  - `requireUser(): Promise<User>`: đọc session rồi **lấy user từ DB**. Không có → `UNAUTHORIZED`. `LOCKED` → `ACCOUNT_LOCKED`.
  - `requireAdmin(): Promise<User>`: như trên, cộng thêm `role !== ADMIN` → `FORBIDDEN`.
  - Session JWT chứa `{ userId, role }`. `middleware.ts` chưa đăng nhập vào `/studio`, `/library`, `/credits`, `/profile`, `/admin` thì chuyển về `/login`.
  - `verifyCredentials` từ chối user LOCKED.

- [ ] **Step 1: Viết test** `account.test.ts`:
  - `register creates free plan and 20 credits`.
  - `register duplicate email (case-insensitive)` → `CONFLICT`.
  - `verifyCredentials wrong password` → `null`.
  - `google links existing email account`.
  - `reset token single use`: dùng lần 2 → `VALIDATION`.
  - `requireUser rejects locked user`: mock `auth()` trả session hợp lệ, user bị LOCKED → `ACCOUNT_LOCKED`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết service, Auth.js config (Credentials + Google), các route, các trang auth (form đơn giản, báo lỗi bằng tiếng Việt).
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5:** Kiểm tra tay bằng `npm run dev`: đăng ký → vào `/studio/image`; đăng xuất → vào `/studio/image` bị chuyển về `/login`.
- [ ] **Step 6: Commit** `feat(auth): đăng ký, đăng nhập, Google, quên mật khẩu`

---

### Task 7: MUSE client (Fake) & lưu trữ

**Files:**
- Create: `src/server/muse/types.ts`, `src/server/muse/fake.ts`, `src/server/muse/index.ts`, `src/lib/storage.ts`, `src/app/api/uploads/route.ts`, `public/samples/sample.jpg`, `public/samples/sample.mp4`, `tests/services/muse.test.ts`, `tests/services/storage.test.ts`

**Interfaces:**
- Produces:
  - ```ts
    type MuseRequest = { museModelId: string; kind: 'image'|'video'; prompt: string;
      aspectRatio: string; resolution: string; imageCount?: number; durationSec?: number;
      withAudio?: boolean; inputUrl?: string }
    type MuseResult = { urls: string[] }
    interface MuseClient { generate(req: MuseRequest): Promise<MuseResult> }
    class MuseError extends Error { code: string }
    ```
  - `FakeMuse implements MuseClient`: đợi `FAKE_MUSE_DELAY_MS` (mặc định 2000). Trả `imageCount` URL tới `${APP_URL}/samples/sample.jpg`, hoặc 1 URL `sample.mp4` cho video. `FAKE_MUSE_FAIL=1` thì ném `MuseError('FAKE_FAIL')`.
  - `getMuseClient(): MuseClient`: `MUSE_API_URL` rỗng thì trả `FakeMuse`, có giá trị thì ném lỗi "chưa hỗ trợ" (client thật làm sau).
  - `buildPrompt(prompt: string, preset?: Preset | null): string` = `prompt` + `", " + preset.promptSuffix` nếu có preset.
  - `presignUpload(userId: string, contentType: string, size: number): Promise<{ uploadUrl: string; fileUrl: string }>`: chỉ nhận `image/jpeg|png|webp`, tối đa 10 MB, nếu không → `VALIDATION`. Key `uploads/{userId}/{uuid}.{ext}`.
  - `putFromUrl(srcUrl: string, key: string): Promise<string>`: tải file nguồn về rồi upload, trả public URL.
  - `deleteObjects(urls: string[]): Promise<void>`
  - `POST /api/uploads` `{ contentType, size }` → `presignUpload`.

- [ ] **Step 1: Viết test**:
  - `FakeMuse returns imageCount urls`.
  - `FakeMuse fails when FAKE_MUSE_FAIL=1`.
  - `buildPrompt appends preset suffix`.
  - `presignUpload rejects gif and >10MB`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết code.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(muse): interface MuseClient, FakeMuse, upload R2`

---

### Task 8: Job, hàng đợi & worker

**Files:**
- Create: `src/lib/queue.ts`, `src/server/services/job.ts`, `worker/index.ts`, `worker/processors/generate.ts`, `worker/cron/index.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/jobs/[id]/params/route.ts`, `src/app/api/jobs/quote/route.ts`, `tests/services/job.test.ts`

**Interfaces:**
- Consumes: `validateParams`, `quote`, `hold`, `charge`, `refund`, `getActivePlan`, `getSetting('maintenance')`, `MuseClient`, `buildPrompt`, `putFromUrl`, `deleteObjects`, `requireUser`
- Produces:
  - `generationQueue: Queue<{ jobId: string }>` (tên `"generation"`)
  - `createJob(userId: string, p: GenerationParams): Promise<Job>`
  - `processJob(jobId: string, muse: MuseClient): Promise<void>`
  - `sweepStuckJobs(now: Date, timeoutMin = 15): Promise<number>`
  - `cancelJob(jobId: string): Promise<void>`: chỉ với job PENDING; set CANCELED và refund.
  - `retryJob(jobId: string): Promise<Job>`: chỉ với job FAILED; tạo job mới cùng params cho cùng user, đi qua `createJob`.
  - `deleteJob(userId: string, jobId: string): Promise<void>`: job không phải của user → `NOT_FOUND`. Set `deletedAt`, xóa file.
  - `listJobs(userId: string, q: { kind?: 'image'|'video'; status?: JobStatus; cursor?: string; ids?: string[] }): Promise<{ items: Job[]; nextCursor?: string }>`: 24 job mỗi trang, bỏ job đã xóa.
  - `cleanupExpiredResults(now: Date): Promise<number>`: job có `expiresAt ≤ now` → xóa file, set `deletedAt`.
- API:
  - `POST /api/jobs/quote` → `{ cost }`
  - `POST /api/jobs` → job
  - `GET /api/jobs?kind&status&cursor&ids`
  - `DELETE /api/jobs/:id`
  - `GET /api/jobs/:id/params` trả params để Tạo lại.
- Luật `createJob`, theo thứ tự:
  1. Đang bảo trì → `MAINTENANCE`.
  2. Model tắt hoặc không tồn tại → `NOT_FOUND`.
  3. Chạy `validateParams`.
  4. Đếm job PENDING + RUNNING của user, `≥ plan.maxConcurrent` → `CONCURRENCY_LIMIT`.
  5. Trong 1 transaction: tạo Job PENDING với `cost = quote(...)`, `expiresAt = now + 30 ngày` nếu gói Free, rồi `hold`.
  6. Ngoài transaction: `generationQueue.add('generate', { jobId }, { priority, jobId })`.
- Luật `processJob`:
  - Chỉ chạy khi job đang PENDING. Set RUNNING và `startedAt`.
  - Gọi `muse.generate` với prompt đã ghép preset.
  - Thành công: `putFromUrl` từng URL vào key `results/{userId}/{jobId}/{i}.{ext}` → SUCCEEDED, `resultUrls`, `finishedAt`, `charge`.
  - Có lỗi: FAILED, `error = code`, `refund`.
- `worker/index.ts`:
  - `new Worker('generation', job => processJob(job.data.jobId, getMuseClient()), { concurrency: 4 })`.
  - Lịch cron (BullMQ repeatable, chạy mỗi 5 phút): `sweepStuckJobs`, `runMonthlyGrants`, `expireSubscriptions`.
  - Chạy hằng ngày: `sendRenewalReminders`, `cleanupExpiredResults`.

- [ ] **Step 1: Viết test** `job.test.ts` (mock `generationQueue.add`, mock `putFromUrl` trả lại đúng src):
  - `createJob holds credit`: Free 20, ảnh 1k × 2 → job PENDING cost 2, `available` = 18, `held` = 2.
  - `createJob concurrency limit`: Free đã có 1 job PENDING → `CONCURRENCY_LIMIT`.
  - `createJob in maintenance` → `MAINTENANCE`.
  - `processJob success charges`: FakeMuse → SUCCEEDED, có 2 `resultUrls`, `held` = 0, `available` = 18.
  - `processJob failure refunds`: FakeMuse lỗi → FAILED, `available` = 20.
  - `processJob twice is no-op`.
  - `sweepStuckJobs refunds timed-out jobs`: job RUNNING có `startedAt` cách 16 phút → FAILED, error `TIMEOUT`, `available` = 20.
  - `cancelJob only pending`.
  - `deleteJob other user` → `NOT_FOUND`.
  - `cleanupExpiredResults` xóa job Free quá 30 ngày.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết `queue.ts`, `job.ts`, worker, cron, route.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5:** Kiểm tra tay: chạy `npm run dev` và `npm run worker`, gọi `curl POST /api/jobs` (kèm cookie session), sau khoảng 2 giây `GET /api/jobs` phải trả job SUCCEEDED.
- [ ] **Step 6: Commit** `feat(job): tạo job, worker, sweeper, cron`

---

### Task 9: Thanh toán QR

**Files:**
- Create: `src/server/services/payment.ts`, `src/app/api/payments/route.ts`, `src/app/api/payments/[id]/route.ts`, `src/app/api/payments/webhook/route.ts`, `tests/services/payment.test.ts`
- Modify: `.env.example` (thêm `BANK_ID`, `BANK_ACCOUNT`, `BANK_ACCOUNT_NAME`, `PAYMENT_WEBHOOK_SECRET`)

**Interfaces:**
- Consumes: `activatePlan`, `grant`, `getSetting('credit_packs')`
- Produces:
  - `createOrder(userId: string, input: { type: 'PLAN'; planCode: 'pro'|'ultra'; period: 'MONTH'|'YEAR' } | { type: 'CREDIT'; credits: 100|500|1000 }): Promise<Payment & { qrUrl: string }>`
    - Số tiền: lấy `plan.priceMonth`/`priceYear`, hoặc giá của gói credit trong `credit_packs`.
    - `refCode` = `"AM"` + 8 ký tự `[A-Z0-9]`.
    - `qrUrl` = `https://img.vietqr.io/image/${BANK_ID}-${BANK_ACCOUNT}-compact2.png?amount=${amount}&addInfo=${refCode}&accountName=${encodeURIComponent(BANK_ACCOUNT_NAME)}`.
  - `handleWebhook(rawBody: string, signature: string | null): Promise<{ ok: boolean }>`
    - Chữ ký HMAC-SHA256(rawBody, `PAYMENT_WEBHOOK_SECRET`) dạng hex không khớp → `UNAUTHORIZED`.
    - Body có dạng `{ transactionId: string; amount: number; description: string }`.
    - Tìm `refCode` trong `description` bằng regex `/AM[A-Z0-9]{8}/`.
    - Không thấy đơn, hoặc `providerTxnId` đã xử lý → `{ ok: true }` và không làm gì.
    - `amount < payment.amount` → giữ PENDING, log, `{ ok: true }`.
    - Đủ tiền → `fulfillPayment`.
  - `fulfillPayment(paymentId: string, opts: { providerTxnId?: string; confirmedBy?: string }): Promise<void>`: trong 1 transaction, chỉ khi đơn còn PENDING → SUCCEEDED, `paidAt`. Đơn PLAN thì `activatePlan`; đơn CREDIT thì `grant(type: 'purchase', paymentId)`.
  - `GET /api/payments/:id` để trang QR poll trạng thái mỗi 3 giây.

- [ ] **Step 1: Viết test** `payment.test.ts`:
  - `createOrder plan uses plan price`, `refCode matches /^AM[A-Z0-9]{8}$/`.
  - `webhook bad signature` → `UNAUTHORIZED`.
  - `webhook fulfills credit order`: purchased +500.
  - `webhook is idempotent`: gửi lại cùng `transactionId` → purchased vẫn +500.
  - `underpaid webhook does not fulfill`: đơn vẫn PENDING.
  - `fulfill plan order activates pro`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết code.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5: Commit** `feat(payment): đơn QR, webhook, kích hoạt gói/credit`

---

### Task 10: Giao diện người dùng: Studio & Thư viện

**Files:**
- Create:
  - `src/app/(user)/layout.tsx` (sidebar + số dư credit ở header)
  - `src/app/(user)/studio/image/page.tsx`, `src/app/(user)/studio/video/page.tsx`
  - `src/app/(user)/library/page.tsx`, `src/app/(user)/library/[id]/page.tsx`
  - `src/components/studio/GenerateForm.tsx`, `ModelSelect.tsx`, `AspectRatioPicker.tsx`, `PresetPicker.tsx`, `ImageUpload.tsx`, `GenerateButton.tsx`
  - `src/components/library/JobGrid.tsx`, `JobCard.tsx`, `MediaViewer.tsx`
  - `src/app/api/catalog/route.ts`
  - `tests/api/catalog.test.ts`

**Interfaces:**
- Consumes:
  - `GET /api/catalog?kind=` → `{ models: (AiModel & { locked: boolean })[]; presets: Preset[]; plan: Plan }`. Trường `locked` = `minPlanRank > plan.rank`.
  - Các API job ở Task 8, `POST /api/uploads`.
- Hành vi:
  - `GenerateForm`:
    - Đổi bất kỳ tham số nào → gọi `/api/jobs/quote` (debounce 300 ms). `GenerateButton` hiển thị `Tạo · {cost} Credit`.
    - Option model bị khóa hiện nhãn "Pro"/"Ultra" và không chọn được.
    - Lỗi `INSUFFICIENT_CREDIT` → hiện link sang `/credits`. Lỗi `CONCURRENCY_LIMIT` → "Bạn đang có N tác vụ chạy, vui lòng chờ".
    - Trang ảnh: chọn tỷ lệ, số ảnh (1/2/4), độ phân giải, preset style, 1 ảnh tham chiếu.
    - Trang video: chọn tỷ lệ, thời lượng (5/10), độ phân giải, preset camera, ảnh khung đầu, bật/tắt âm thanh (chỉ hiện khi `model.options.audio`).
  - `?from={jobId}` trên trang studio → điền form bằng `GET /api/jobs/:id/params`. Đây là nút "Tạo lại".
  - `JobGrid`: tab Ảnh / Video, lọc theo trạng thái. Job PENDING/RUNNING được poll `GET /api/jobs?ids=` mỗi 3 giây cho tới khi xong.
  - Trang chi tiết: xem ảnh/video, prompt, tham số, cost, các nút Tải xuống / Tạo lại / Xóa.

- [ ] **Step 1: Viết test** `catalog.test.ts`: user Free → MUSE Video Pro có `locked: true`, MUSE Video có `locked: false`; model bị tắt không xuất hiện.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL. Viết route. Chạy lại. Kết quả mong đợi: PASS.
- [ ] **Step 3:** Viết các trang và component.
- [ ] **Step 4:** Kiểm tra tay (cần `dev` + `worker` cùng chạy):
  - Tạo ảnh 2 tấm → nút báo `2 Credit`, số dư header giảm 2, thẻ chuyển từ "Đang xử lý" sang "Hoàn tất".
  - Bấm Tạo lại → form điền đúng như cũ.
  - Xóa → thẻ biến mất.
- [ ] **Step 5: Commit** `feat(ui): studio ảnh/video và thư viện`

---

### Task 11: Giao diện người dùng: Credit, Hồ sơ, Bảng giá

**Files:**
- Create: `src/app/(user)/credits/page.tsx`, `src/app/(user)/credits/pay/[id]/page.tsx`, `src/app/(user)/profile/page.tsx`, `src/app/pricing/page.tsx`, `src/app/api/credits/route.ts`, `src/app/api/me/password/route.ts`, `tests/api/credits.test.ts`

**Interfaces:**
- Consumes: `getBalance`, `getActivePlan`, `createOrder`, `updateProfile`, `changePassword`
- Produces: `GET /api/credits?cursor` → `{ balance, plan, subscription, transactions: CreditTransaction[] (30 dòng mỗi trang), payments: Payment[] }`
- Hành vi:
  - Trang `/pricing`: công khai. Hiện 3 cột gói lấy từ DB, nút chuyển Tháng/Năm (hiện mức tiết kiệm), bảng credit lẻ. Bấm mua → `POST /api/payments` → sang `/credits/pay/:id`.
  - Trang `/credits/pay/:id`: ảnh QR, số tiền, nội dung chuyển khoản. Poll trạng thái; khi đơn SUCCEEDED thì báo thành công và chuyển về `/credits`.
  - Trang `/credits`: số dư (khả dụng / đang giữ / credit gói / credit mua), gói hiện tại cùng ngày hết hạn, lịch sử giao dịch (tên loại hiển thị bằng tiếng Việt), lịch sử thanh toán.
  - Trang `/profile`: sửa tên, avatar (upload qua `/api/uploads`), đổi mật khẩu.

- [ ] **Step 1: Viết test** `credits.test.ts`: sau khi grant + hold, `GET /api/credits` trả `balance.held` = cost của job và `transactions[0].type` = `hold`.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL. Viết route. Chạy lại. Kết quả mong đợi: PASS.
- [ ] **Step 3:** Viết các trang.
- [ ] **Step 4:** Kiểm tra tay: tạo đơn credit 100, giả lập webhook bằng `curl` có chữ ký HMAC đúng → trang QR tự chuyển sang "Thành công", số dư tăng 100.
- [ ] **Step 5: Commit** `feat(ui): trang credit, thanh toán QR, hồ sơ, bảng giá`

---

### Task 12: Cổng quản trị (Admin)

**Files:**
- Create:
  - `src/server/services/admin.ts`
  - `src/app/api/admin/**/route.ts`: `stats`, `users`, `users/[id]`, `users/[id]/credits`, `models`, `plans`, `presets`, `jobs`, `jobs/[id]`, `payments`, `payments/[id]/confirm`, `settings`
  - `src/app/admin/layout.tsx`, `src/app/admin/page.tsx` (dashboard), và các trang `users`, `users/[id]`, `models`, `credit-rules`, `plans`, `presets`, `jobs`, `payments`, `settings`
  - `src/components/admin/DataTable.tsx`, `EntityForm.tsx`, `StatCard.tsx`, `LineChart.tsx` (dùng recharts)
  - `tests/services/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`, `adminAdjust`, `activatePlan`, `startFree`, `cancelJob`, `retryJob`, `fulfillPayment`, `setSetting`
- Produces:
  - `getStats(range: '1d'|'7d'|'30d', now?: Date): Promise<{ newUsers: number; images: number; videos: number; creditsSpent: Decimal; revenue: number; usersByPlan: Record<'free'|'pro'|'ultra', number>; daily: { date: string; images: number; videos: number }[] }>`. Trong đó `creditsSpent` = tổng hold của các job đã có `charge`; `revenue` = tổng `Payment.amount` có trạng thái SUCCEEDED.
  - `listUsers(q: { search?: string; plan?: string; page: number }): Promise<{ items: (User & { planCode: string; available: Decimal })[]; total: number }>`: 20 user mỗi trang.
  - `setUserStatus(userId: string, status: 'ACTIVE'|'LOCKED', actorId: string): Promise<void>`: admin không tự khóa chính mình (`VALIDATION`).
  - `adminChangePlan(userId: string, planCode: 'free'|'pro'|'ultra', period: 'MONTH'|'YEAR'): Promise<void>`: đổi sang `free` thì đóng sub hiện tại, `expirePlanCredits`, `startFree`.
  - CRUD model, plan, preset qua zod schema. Không cho xóa model đã có job, chỉ tắt (`enabled = false`). Không cho xóa plan.
  - Trang `credit-rules`: sửa `baseCost` của từng model và setting `resolution_multipliers`, có bảng xem trước giá với vài tổ hợp mẫu (gọi `quote`).
  - Trang `jobs`: lọc theo trạng thái, user, model; nút Hủy (job PENDING) và Chạy lại (job FAILED); xem `error`.
  - Trang `payments`: lọc theo trạng thái; nút "Xác nhận" cho đơn PENDING → `fulfillPayment(id, { confirmedBy })`.
  - Trang `settings`: bật/tắt bảo trì, sửa `credit_packs`, hiện trạng thái MUSE (hiện tại là "FakeMuse").

- [ ] **Step 1: Viết test** `admin.test.ts`:
  - Mọi route `/api/admin/*` gọi bằng user thường → 403 `FORBIDDEN` (test 1 route đại diện + `requireAdmin`).
  - `getStats counts` khớp dữ liệu seed trong test.
  - `admin cannot lock self`.
  - `adjust credit requires reason`.
  - `disable model hides it from catalog`.
  - `manual confirm fulfills once`: gọi 2 lần → credit chỉ cộng 1 lần.
- [ ] **Step 2:** Chạy test. Kết quả mong đợi: FAIL.
- [ ] **Step 3:** Viết service, route, các trang.
- [ ] **Step 4:** Chạy test. Kết quả mong đợi: PASS.
- [ ] **Step 5:** Kiểm tra tay:
  - Đăng nhập admin seed, khóa 1 user → user đó gọi bất kỳ API nào cũng nhận `ACCOUNT_LOCKED`.
  - Bật bảo trì → bấm Tạo thì báo đang bảo trì.
- [ ] **Step 6: Commit** `feat(admin): dashboard, user, model, giá, gói, preset, job, thanh toán, cài đặt`

---

## Hoàn tất
- [ ] `npm test` xanh toàn bộ, `npm run build` OK.
- [ ] Chạy thử luồng đầy đủ: đăng ký → tạo ảnh và video bằng FakeMuse → mua Pro qua webhook giả → tạo video 1080p → admin thấy số liệu trên dashboard.
- [ ] Cập nhật README: cách chạy dev (`docker compose up -d`, `npm run db:migrate`, `npm run db:seed`, `npm run dev`, `npm run worker`).
