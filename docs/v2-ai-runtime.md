# AI runtime v2 — tốc độ, tài khoản, model, sơ đồ luồng

## Số đo thật (10/11/2026) — vì sao viết prompt chậm
| Cách gọi | Model | Thời gian |
|---|---|---|
| agy CLI mỗi lần 1 tiến trình (`agy -p`) | claude-sonnet-5-5-low | 6–10 s (khởi động + ~7k token context mặc định) |
| **agy ACP chạy sẵn** (`agy acp`, mở phiên mới) | gemini-3.8-flash-low | **~4.0 s** (mở phiên ~15 ms) |
| agy ACP | claude-sonnet-5-5-low | ~4.6 s |
| agy ACP | gemini-3.8-flash-medium | 14–17 s |
| codex exec, effort low | gpt-6.1-sol | 13.6 s |
| codex exec, effort low | gpt-6-luna | 7.2 s |
| Muse chat (muse2api) | muse-chat | 14–22 s |

Tối ưu: (1) agy qua **ACP pool** thường trực; (2) mặc định model nhanh (gemini-3.8-flash-low / claude-sonnet-5-5-low), codex luna + low; (3) **viết trước** (prewrite) khi người dùng còn gõ → bấm Tạo lấy ngay từ cache; (4) cache prompt theo (skill, ý tưởng, style, camera, tỷ lệ, thời lượng, ảnh); (5) tùy chọn `race`: chạy song song 2 provider đầu, lấy cái xong trước; (6) agy hết quota → proxy xoay tài khoản (antigravity-switcher) thay vì rơi xuống codex.

## Thành phần backend
- `src/server/ai/acp/{rpc,agent,pool}.ts` — port từ EDUVN gateway: pool `AGY_ACP_PROCESSES` (mặc định 1) tiến trình `agy acp --include-default-customizations=false --disable-telemetry --sandbox --gemini_dir <data>/agy-acp/gemini-N`, mỗi tiến trình nhiều phiên song song, tái khởi động khi chết / không khỏe / sau `AGY_RECYCLE_SESSIONS` phiên, xóa dữ liệu phiên khi đóng. Env `CLOUD_CODE_URL=http://127.0.0.1:<proxyPort>` khi bật proxy xoay tài khoản. Danh sách model lấy từ `session/new` (`availableModels`).
- Gateway agy runner: ACP trước, lỗi khởi động ACP thì về CLI cũ.
- `tools/agy/switcher_bridge.py` — import `~/tool-app/antigravity-switcher/switcher.py` (đường dẫn `AGY_SWITCHER_DIR`), lệnh JSON: `status` (email, active, quota % theo nhóm model + reset), `auth-url` (url + verifier), `exchange <callbackUrlOrCode> <verifier>`, `switch <id|auto>`, `remove <id>`. Không bao giờ trả token.
- Proxy xoay tài khoản: AuraMotion chạy proxy riêng (`proxy.py` của switcher) cổng `AGY_PROXY_PORT` (mặc định 8901) khi `ai.agy.proxy = true`.
- Codex profile: `CODEX_HOME` = `~/.codex` (mặc định) hoặc `data/codex/<name>`. `codex login status`, `codex login --device-auth` (bắt URL + mã từ stdout, giữ tiến trình tới khi xong), `codex logout`. Catalog model: `codex debug models` (chỉ `visibility != hide`) + mức effort hỗ trợ.

## Setting `ai_roles` (thay `ai_gateway`, đọc tương thích ngược)
```json
{
  "writer": { "chain": [{"provider":"agy","model":"gemini-3.8-flash-low"},{"provider":"codex","model":"gpt-6-luna","effort":"low"},{"provider":"muse"}], "strategy": "fallback", "timeoutSec": 60 },
  "story":  { "chain": [{"provider":"muse"},{"provider":"agy","model":"claude-sonnet-5-5-low"}] },
  "prewrite": true,
  "cacheHours": 72,
  "agy":   { "transport": "acp", "proxy": false },
  "codex": { "profile": "default" }
}
```
`strategy`: `fallback` (lần lượt) | `race` (chạy 2 mắt xích đầu song song, lấy kết quả hợp lệ đầu tiên, hủy cái còn lại).

## API admin (requireAdmin)
| Method | Path | Trả về |
|---|---|---|
| GET | `/api/admin/ai` | `{ roles, providers: { agy: {installed, version, transport, acp:{alive, processes, sessions}, accounts:[{id,email,active,quota:[{group,pct,resetAt}]}], proxy:{enabled,port,running}, models:[{id,name}]}, codex: {installed, version, profiles:[{name, loggedIn, method, active}], models:[{id,name,efforts[],defaultEffort}]}, muse: {ok, accounts} }, health, cooldowns }` |
| PUT | `/api/admin/ai/roles` | lưu `ai_roles` (zod) |
| POST | `/api/admin/ai/test` | body `{provider, model?, effort?, skillId?, kind?, idea}` → `{text, prompt?, ms, breakdown:{startMs?, sessionMs?, modelMs?}, provider, model}` |
| POST | `/api/admin/ai/agy/login` | `{url, state}` (state giữ verifier phía server, hết hạn 10 phút) |
| POST | `/api/admin/ai/agy/login/finish` | body `{state, callback}` (dán URL callback hoặc mã) → `{account:{id,email}}` |
| POST | `/api/admin/ai/agy/switch` | body `{id}` hoặc `{auto:true}` |
| DELETE | `/api/admin/ai/agy/accounts/:id` | gỡ tài khoản |
| POST | `/api/admin/ai/agy/proxy` | body `{enabled}` bật/tắt proxy xoay tài khoản |
| POST | `/api/admin/ai/acp/restart` | khởi động lại pool ACP |
| POST | `/api/admin/ai/codex/login` | body `{profile}` → `{loginId, url, code}` |
| GET | `/api/admin/ai/codex/login/:loginId` | `{status: "waiting"|"done"|"error", message?}` |
| POST | `/api/admin/ai/codex/logout` | body `{profile}` |
| GET | `/api/admin/flow` | cấu hình luồng sống (xem dưới) |
| GET | `/api/admin/flow/jobs?limit=20` | job gần đây có trace |
| GET | `/api/jobs/:id/trace` (user, job của mình) và `/api/admin/jobs/:id/trace` | trace |

## Prewrite (người dùng)
`POST /api/ai/prewrite` body `{idea, kind:"image"|"video", skillId?, styleId?, cameraId?, aspect, durationSec?, hasRef?}` → `{key, status:"ready"|"pending", prompt?, skill?, provider?}`. Gọi lại cùng tham số → trả ready khi xong. Job `autoWrite` dùng cache nếu khớp khóa (trace ghi `cache: true`).

## Trace job (`params.trace`, ms epoch)
`{ createdAt, queuedAt, writeStart, writeEnd, writer:{provider, model, skill, cache}, slotAt, submitAt, engine:{provider, model, account?}, doneAt, failedAt?, error? }` — worker ghi từng mốc; SSE `job` kèm `trace`.

## `/api/admin/flow` (dữ liệu cho sơ đồ)
`{ nodes: [{id, kind:"user"|"api"|"queue"|"worker"|"gateway"|"skill"|"writer"|"executor"|"muse2api"|"muse-tab"|"validate"|"storage"|"realtime", title, subtitle, ai?: {provider, model, account?}, stats?: {...}}], edges: [{from, to, label?}], live: {queues:{...}, slots:{...}, activeJobs:[{id, kind, stage}]} }` — dựng từ cấu hình thật (ai_roles, model đang bật, tài khoản Muse/agy/codex, slot).
