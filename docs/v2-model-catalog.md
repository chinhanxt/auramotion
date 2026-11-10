# Model catalog v2 — người dùng chọn theo tên model, quota agy/codex, codex app-server

Đã duyệt 10/11/2026: (1) người dùng chọn model theo tên (nhóm theo hãng), admin đồng bộ + bật/tắt + đặt giá;
(2) quota agy chia 2 cột Gemini | Claude, codex có thanh quota 5 giờ + tuần theo profile; (3) codex chạy thường trực qua `codex app-server`;
(4) sơ đồ luồng chế độ trực tiếp KHÔNG gán sẵn model lên thẻ (chỉ hãng/vai trò); model thật chỉ hiện khi phát lại 1 job.

## Sự thật đã kiểm
- Mỗi dòng `AiModel` hiện là 1 "engine" gắn cứng 1 `engineModel` (seed). Codex Ảnh để trống → CLI dùng `gpt-6.1-sol` từ config.toml.
- Ảnh agy/codex: model LLM chỉ điều khiển công cụ vẽ có sẵn (agy `generate_image`, codex image tool). Model nào vẽ được phải test thật (`scripts` của director, kết quả ghi vào `verified`).
- agy chỉ còn Claude 5.5 (không còn 4.6). Danh sách thật: ACP `session/new.availableModels`.
- codex model khác nhau theo profile (`~/.codex`, `~/.codex_profiles/*`).
- `codex app-server` (JSON-RPC stdio, thường trực): `initialize`, `thread/start`, `turn/start`, thông báo item/turn, `account/rateLimits/read` (primary = 5 giờ, secondary = tuần: `used_percent`, `window_minutes`, `resets_at`). Log phiên `~/.codex/sessions/**/rollout-*.jsonl` cũng có `rate_limits` (dự phòng).

## Dữ liệu (Prisma `AiModel` thêm trường)
- `vendor String @default("")` — `muse | google | anthropic | openai | local`
- `displayName String @default("")` — tên đẹp cho người dùng, vd "Gemini 3.8 Flash", "Claude Opus 5.5", "GPT-6.1 Sol", "Muse Image"
- `badge String @default("")` — nhãn ngắn: "Nhanh", "Đẹp", "Mới", "Pro"
- `description String @default("")`
- `etaSec Int?` — thời gian ước tính hiển thị
- `verified Json?` — `{ ok: boolean, testedAt, ms, error?, sampleUrl? }` (test vẽ ảnh/video thật)
- `source String @default("manual")` — `manual | synced`
- Giữ `name` duy nhất (khóa nội bộ, vd `agy:gemini-3.8-flash-low:IMAGE`), `provider`, `engineModel`, `kind`, `minPlanRank`, `baseCost`, `options.museAccount`, `enabled`, `sort`.
- Dòng cũ: điền `vendor/displayName` (MUSE Ảnh → muse "Muse Image", MUSE Ảnh 2 → muse "Muse Image · TK2", Gemini Ảnh → google "Gemini 3.8 Flash", Codex Ảnh → openai "GPT-6.1 Sol" + engineModel `gpt-6.1-sol`, MUSE Video → muse "Muse Video").

## API
| Method | Path | |
|---|---|---|
| GET | `/api/catalog?kind=image\|video` | `models[]` thêm `vendor, displayName, badge, description, etaSec, verified:{ok}`; chỉ dòng `enabled` (đã có); sắp theo vendor rồi sort |
| POST | `/api/admin/models/sync` | lấy danh sách thật agy (ACP) / codex (hợp các profile, bỏ hidden) / muse → tạo dòng `synced` cho mỗi (model × kind hỗ trợ: agy/codex → IMAGE; muse → IMAGE/VIDEO), **mặc định tắt**, không đụng dòng đã có; trả `{created, existing}` |
| POST | `/api/admin/models/:id/verify` | test thật 1 ảnh nhỏ (hoặc video 5 s với Muse) bằng đúng model đó, ghi `verified`, trả kết quả + `sampleUrl` (lưu storage) |
| PATCH | `/api/admin/models/:id` | thêm các trường mới |
| GET | `/api/admin/ai` | `providers.codex.profiles[].quota = { primary: {usedPercent, windowMinutes, resetsAt}, secondary: {...}, source: "app-server"\|"session-log", checkedAt }`; agy accounts giữ `quota[]` nhưng thêm `groups: { gemini: {fiveHour, weekly, resetAt...}, claude: {...} }` |

## Codex app-server
- `src/server/ai/codex/appserver.ts`: client JSON-RPC (dùng lại `src/server/ai/acp/rpc.ts`), 1 tiến trình thường trực cho profile đang bật (`CODEX_HOME`), khởi động lười, tự khởi động lại khi chết, tắt khi worker/app dừng.
- Gateway codex runner: `thread/start` (model, effort, sandbox read-only, không tool) + `turn/start` với prompt → gom chữ agent message đến khi turn hoàn tất; lỗi khởi động → về `codex exec` cũ. Ghi breakdown start/session/model như ACP.
- Quota: `account/rateLimits/read` cho profile đang bật (qua tiến trình thường trực); profile khác: mở app-server tạm (timeout 20 s) rồi tắt, cache 5 phút; lỗi → đọc `rate_limits` mới nhất trong log phiên của profile đó.
- Ảnh codex vẫn dùng `codex exec` (đường lưu ảnh `generated_images` đã chạy ổn).

## Giao diện
- **Studio (ảnh, video):** chip engine → bộ chọn model: popover/sheet nhóm theo hãng (Muse, Google, Anthropic, OpenAI) với logo monogram màu hãng, `displayName`, badge, giá Credit, ETA; khóa theo gói; tìm nhanh. Chip hiện "logo · displayName". Mỗi model chỉ 1 dòng (không "MUSE Ảnh 2" mơ hồ: dùng displayName "Muse Image · TK2").
- **Admin Model:** nhóm theo hãng; nút "Đồng bộ model"; mỗi dòng: bật/tắt, displayName, badge, giá, gói, (Muse) tài khoản, nút "Test vẽ" (skeleton → ảnh mẫu + thời gian / lỗi), trạng thái verified; engineModel là danh sách chọn từ model thật (không gõ tay), vẫn cho nhập tay ở chế độ nâng cao.
- **Admin AI:** tài khoản agy: mỗi dòng 2 cột Gemini | Claude (thanh 5 giờ + tuần, đếm ngược reset); hồ sơ codex: thanh 5 giờ + tuần, nguồn + lúc cập nhật.
- **Sơ đồ luồng (/admin/flow):** chế độ trực tiếp: thẻ AI viết / engine chỉ ghi hãng + vai trò ("Muse · model người dùng chọn", "agy · theo chuỗi AI viết"), số model đang bật; không chip model. Chế độ phát lại: thẻ trên đường đi đổi sang model/tài khoản thật của job.
