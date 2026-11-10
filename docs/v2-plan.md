# AuraMotion v2 — kế hoạch & hợp đồng API

Nhánh nền: `v2` (từ `dev2` + gộp `rv-ui`). Mọi chữ hiển thị: **tiếng Việt**, ít chữ.

## 0. Sự thật đã kiểm chứng (10/11/2026, tài khoản Muse thật, gói Free)
- muse2api riêng của AuraMotion: `:18610`, dữ liệu `data/muse2api`, CDP `19230`, headless Chrome `/opt/google/chrome/chrome`.
- Ảnh Muse 9:16: ~29 s / ảnh.
- muse2api: **mỗi request media mở 1 thread mới ở 1 tab riêng** = "chat phụ"; chat có `user` (conversation key) giữ 1 thread = "chat chính". Số tab/tài khoản = `MUSE2API_ACCOUNT_MAX_CONCURRENCY` (đặt 3).
- Bài học Muse cũ (AffKit/EM BÔNG): video gửi cách nhau ≥ 20 s; tải nhiều video cùng lúc từng ra file hỏng → phải kiểm mp4 bằng ffprobe; prompt video ngắn; 1 chuyển động camera/cảnh, **không zoom giật**, thích cảnh nối liền (match-cut). Khóa nhân vật: mô tả bằng từ vựng của Muse (loài/kiểu người + 3–5 màu nhận diện).

## 1. Luồng chính
```
Ý tưởng ─► AI Gateway (agy | codex | Muse chat chính) + Skill template ─► prompt / kịch bản nhiều cảnh
        ─► createJob (hold Credit) ─► BullMQ ─► worker
             muse  : Muse scheduler (slot chat phụ + giãn cách gửi) ─► muse2api ─► kiểm file ─► storage
             cli   : agy / codex tạo ảnh
             story : lập kịch bản bằng chat chính → sinh N job VIDEO chạy song song ở N chat phụ → (tùy chọn) tự ghép
             post  : ghép VieNeu + nhạc + phụ đề (assemble.py)
        ─► Redis pub/sub `am:ev:<userId>` ─► SSE `/api/events` ─► UI (skeleton → kết quả, toast)
```

## 2. Dữ liệu mới (Prisma)
- `PromptSkill` { id, slug @unique, name, kind: `IMAGE|VIDEO|STORY|SCRIPT`, description, instructions (Text), template (Text, biến `{{idea}} {{style}} {{camera}} {{aspect}} {{duration}} {{shots}}`), minPlanRank Int @default(0), enabled, sort, createdAt, updatedAt }.
- `Preset` thêm: `slug String? @unique`, `category String @default("")`, `description String @default("")`, `cover String?` (CSS gradient hoặc URL ảnh), `palette String[] @default([])`, `sort Int @default(0)`, `featured Boolean @default(false)`.
- `Story` { id, userId, title, idea, skillId?, styleId?, cameraId?, aspect, shotCount, shotDurationSec, mode `PARALLEL|CHAIN`, autoAssemble Boolean, assemble Json (giọng/nhạc/phụ đề, tùy chọn), status `PLANNING|READY|RENDERING|ASSEMBLING|DONE|FAILED|CANCELED`, plan Json (`{shots:[{index,title,prompt,camera?,durationSec}]}`), threadKey (chat chính Muse), planner (`agy|codex|muse`), error?, finalJobId?, createdAt, updatedAt, deletedAt? }.
- `Job` thêm: `storyId String?`, `shotIndex Int?`, `progress Int @default(0)`, `featured Boolean @default(false)`.

## 3. API cho người dùng (JSON, lỗi dạng `{error:{code,message}}`)
| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/catalog?kind=image\|video\|assemble\|story` | thêm `skills: CatalogSkill[]`, `presets` có `slug,category,description,cover,palette` |
| GET | `/api/themes` | danh sách STYLE + CAMERA đầy đủ (công khai, dùng cho landing) |
| GET | `/api/explore?cursor=` | job `featured` SUCCEEDED (công khai): `{items:[{id,kind,prompt,resultUrls,presetName?}], nextCursor}` |
| POST | `/api/ai/prompt` | giữ cũ + `skillId?`, `styleId?`, `cameraId?`; trả thêm `provider` |
| POST | `/api/stories` | body `{idea, title?, skillId?, styleId?, cameraId?, aspect, shotCount(2–8), shotDurationSec(5\|10), mode, autoRun:boolean, autoAssemble:boolean}` → `{story}` (status PLANNING) |
| GET | `/api/stories?cursor=` | `{items: StoryItem[], nextCursor}` |
| GET | `/api/stories/:id` | `{story: StoryItem & {jobs: JobItem[]}}` |
| PATCH | `/api/stories/:id` | sửa `title`, `plan.shots[].prompt/title` khi READY |
| POST | `/api/stories/:id/render` | READY → tạo N job VIDEO (hold Credit) → RENDERING |
| POST | `/api/stories/:id/shots/:index/retry` | quay lại 1 cảnh lỗi |
| POST | `/api/stories/:id/assemble` | ghép các cảnh xong thành 1 video (job ASSEMBLE) |
| DELETE | `/api/stories/:id` | hủy job chờ, ẩn story |
| GET | `/api/events` | **SSE**. Sự kiện `job` `{id,status,progress,resultUrls,error,storyId,shotIndex,kind}`; `story` `{id,status,plan?,error?}`; `credit` `{balance}`; `ping` mỗi 20 s |

`StoryItem` = `{id,title,idea,status,aspect,shotCount,shotDurationSec,mode,autoAssemble,plan,error,finalJobId,createdAt, cover?: string (ảnh/video đầu tiên)}`.
`JobItem` thêm `progress`, `storyId`, `shotIndex`, `params` (cần cho UI hiện aspect/duration).
`CatalogSkill` = `{id,slug,name,kind,description,locked}`.

## 4. API admin (requireAdmin)
| Path | Ghi chú |
|---|---|
| `/api/admin/skills` GET/POST, `/api/admin/skills/:id` PATCH/DELETE | CRUD PromptSkill + `POST /api/admin/skills/:id/test` `{idea}` → chạy thử qua gateway, trả text |
| `/api/admin/presets` (đã có) | thêm trường mới; `POST /api/admin/presets/:id/cover` → tạo job ảnh Muse làm bìa (admin chịu, không trừ Credit) |
| `/api/admin/stories` GET, `/api/admin/stories/:id` GET/DELETE | xem/hủy |
| `/api/admin/muse/accounts` GET/POST(import cookie JSON) · `/api/admin/muse/accounts/:id` PATCH(enable,label)/DELETE · `.../renew` POST · `.../quota` GET | proxy muse2api `/admin/*` bằng `MUSE2API_ADMIN_KEY \|\| MUSE_API_KEY` |
| `/api/admin/muse/status` GET | `/admin/status` + `/readyz` + task đang chạy của muse2api |
| `/api/admin/gateway` GET/PUT | setting `ai_gateway` `{order:["agy","codex","muse"], agyModel, codexModel, timeoutSec}` + health từng provider (độ trễ lần cuối, lỗi cuối) |
| `/api/admin/queues` GET | đếm waiting/active/delayed/failed từng hàng đợi BullMQ + job đang chạy; `POST /api/admin/queues/:name/(pause\|resume)` |
| `/api/admin/jobs/:id` PATCH `{featured}` | đánh dấu nổi bật cho Explore |
| `/api/admin/settings` (đã có) | thêm khóa `muse_slots` `{image:2, video:2, chat:1, gapSec:20, sendVideoAspect:false}` , `story` `{planCost:0.5, maxShots:8}` |

## 5. Phân việc
- **BE (backend)**: §2, §3, §4 phần server; AI Gateway `src/server/ai/gateway.ts`; Muse scheduler (Redis semaphore + giãn cách) trong worker; kiểm mp4/ảnh sau tải (ffprobe); tiến độ job từ `progress` của muse2api → DB + pub/sub; hàng đợi `story`; seed skill + theme; dọn việc backend trong `TODO.md`; test vitest.
- **UI (người dùng)**: design system + toàn bộ trang người dùng + landing + Story studio + SSE hook + toast + skeleton.
- **ADMIN**: làm lại giao diện admin theo design system + trang mới (Skill, Theme, Story, Muse, Gateway, Hàng đợi, Nổi bật).

## 6. Quy tắc chung
- Lệnh nặng (`npx tsc --noEmit`, `npx vitest run ...`, `npm run build`, `npx prisma ...`) **luôn** chạy qua `flock /tmp/auramotion-heavy.lock <lệnh>` — máy 15 GB RAM đang có việc khác, từng sập khi chạy song song.
- Không chạy `next dev`/`next build` song song với agent khác; chỉ agent điều phối (director) chạy app thật và Muse thật.
- Không đổi hành vi credit/payment đang đúng; mọi thay đổi Credit qua `server/services/credit`.
- Commit nhỏ theo từng phần, message tiếng Việt kiểu `feat(story): ...`, kết thúc bằng `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Không push.
