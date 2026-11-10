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
- Gateway agy runner: ACP trước, lỗi khởi động ACP thì về CLI cũ (thử lại ACP sau 30 s). `AGY_TRANSPORT=cli|acp` ghi đè `ai.agy.transport` (test dùng `cli`). Dữ liệu chạy ở `AURA_DATA_DIR` (mặc định `data/`): `agy-acp/`, `agy-proxy/`, `codex/`.
- Quota: tạm nghỉ theo **provider + model** (`am:gw:cooldown:<provider>:<model>[@profile]`), tối đa 30 phút, trong lúc nghỉ cứ 5 phút chạy nền 1 câu thử ngắn, được thì bỏ nghỉ. agy hết quota: proxy bật → chờ proxy xoay rồi chạy lại 1 lần, không tạm nghỉ; proxy tắt → `switch auto` 1 lần (rồi khởi động lại pool ACP) và chạy lại, vẫn lỗi mới tạm nghỉ.
- `tools/agy/switcher_bridge.py` — import `~/tool-app/antigravity-switcher/switcher.py` (đường dẫn `AGY_SWITCHER_DIR`), lệnh JSON: `status` (email, active, quota % theo nhóm model + reset), `auth-url` (url + verifier), `exchange <callbackUrlOrCode> <verifier>`, `switch <id|auto>`, `remove <id>`, `proxy-status|proxy-start|proxy-stop --port --pid-file`. Không bao giờ trả token (chuỗi giống token bị che `***`). `exchange` không tham số thì đọc `{callback, verifier}` từ stdin (AuraMotion dùng cách này để verifier không hiện trên danh sách tiến trình).
- Proxy xoay tài khoản: AuraMotion chạy proxy riêng (`proxy.py` của switcher) cổng `AGY_PROXY_PORT` (mặc định 8901, từ chối 8899/8900 của chủ máy), pid/log ở `data/agy-proxy/` khi `ai.agy.proxy = true`.
- Codex profile: `default` = `~/.codex` (env `CODEX_HOME`), mọi thư mục trong `~/.codex_profiles/*` (env `CODEX_PROFILES_DIR`; tên có thể có dấu cách, vd `acc 6`; `profiles.json` chỉ đọc để lấy email/alias), và `data/codex/<name>` tạo từ web (tên `[a-z0-9_-]`). `codex login status`, `codex login --device-auth` (bắt URL + mã từ stdout, giữ tiến trình tới khi xong), `codex logout`. Catalog model theo từng profile: `CODEX_HOME=<dir> codex debug models` (cache 10 phút), giữ cả model `visibility: hide` với `hidden: true`.

## Setting `ai_roles` (thay `ai_gateway`, đọc tương thích ngược)
```json
{
  "writer": { "chain": [{"provider":"agy","model":"gemini-3.8-flash-low"},{"provider":"codex","model":"gpt-6-luna","effort":"low"},{"provider":"muse"}], "strategy": "fallback", "timeoutSec": 60 },
  "story":  { "chain": [{"provider":"muse"},{"provider":"agy","model":"claude-sonnet-5-5-low"}], "strategy": "fallback", "timeoutSec": 120 },
  "router": { "chain": [{"provider":"agy","model":"gemini-3.8-flash-low"},{"provider":"codex","model":"gpt-6-luna","effort":"low"}], "strategy": "fallback", "timeoutSec": 20 },
  "prewrite": true,
  "cacheHours": 72,
  "agy":   { "transport": "acp", "proxy": false },
  "codex": { "profile": "default" }
}
```
`strategy`: `fallback` (lần lượt) | `race` (chạy 2 mắt xích đầu song song, lấy kết quả hợp lệ đầu tiên, hủy cái còn lại; cả hai lỗi thì chạy tiếp phần còn lại của chuỗi). Mắt xích codex có thể ghi `"profile"` riêng (mặc định = `codex.profile`). Chưa có `ai_roles`: dựng từ `ai_gateway` (thứ tự, model, timeout) + `prompt_writer` (provider lên đầu chuỗi writer). `router` = tầng AI của bộ chọn skill (`src/server/ai/router.ts`); `story` = lập kịch bản (planner của story lên đầu chuỗi). PUT `/api/admin/gateway` (API cũ) ghi vào `ai_roles.writer`.

## API admin (requireAdmin)
| Method | Path | Trả về |
|---|---|---|
| GET | `/api/admin/ai` | `{ roles, providers: { agy: {installed, version, transport, acp:{alive, processes, sessions}, accounts:[{id,email,active,status,quota:[{group,pct,resetAt}],minQuota?,error?}], accountsError?, proxy:{enabled,port,running}, models:[{id,name,live}]}, codex: {installed, version, profiles:[{name, source:"default"|"external"|"web", email?, alias?, loggedIn, method, active, models:[…], modelsError?}], models:[{id,name,efforts[],defaultEffort,hidden,profiles[]}]}, muse: {ok, accounts:[{id,label,enabled,status,kinds}]} }, health, cooldowns: {"<provider>:<model>": giây} }` — `?refresh=1` bỏ cache quota agy / catalog codex. `agy.models` = danh sách ACP (`live: true`) + các biến thể gemini-3.8-flash / claude-sonnet-5-5 / claude-opus-5-5 luôn có (`live: false` nếu ACP chưa liệt kê). |
| PUT | `/api/admin/ai/roles` | lưu `ai_roles` (zod) → `{roles}`; đổi `agy.proxy` thì bật/tắt proxy như POST proxy |
| POST | `/api/admin/ai/test` | body `{provider, model?, effort?, profile?, skillId?, kind?, idea}` → `{text, prompt, ms, breakdown:{startMs?, sessionMs?, modelMs?}, provider, model}` (chỉ đúng 1 mắt xích, không rơi sang provider khác) |
| POST | `/api/admin/ai/agy/login` | `{url, state}` (state giữ verifier phía server, hết hạn 10 phút) |
| POST | `/api/admin/ai/agy/login/finish` | body `{state, callback}` (dán URL callback hoặc mã) → `{account:{id,email}, created}` (không tự chuyển sang tài khoản mới) |
| POST | `/api/admin/ai/agy/switch` | body `{id}` hoặc `{auto:true}` → `{switched, account:{id,email}}` |
| DELETE | `/api/admin/ai/agy/accounts/:id` | gỡ tài khoản |
| POST | `/api/admin/ai/agy/proxy` | body `{enabled}` bật/tắt proxy xoay tài khoản |
| POST | `/api/admin/ai/acp/restart` | khởi động lại pool ACP |
| POST | `/api/admin/ai/codex/login` | body `{profile}` → `{loginId, url, code}` (profile chưa có → tạo `data/codex/<profile>`) |
| GET | `/api/admin/ai/codex/login/:loginId` | `{status: "waiting"|"done"|"error", message?}` |
| POST | `/api/admin/ai/codex/logout` | body `{profile}` → `{loggedIn, method}` |
| GET | `/api/admin/flow` | cấu hình luồng sống (xem dưới) |
| GET | `/api/admin/flow/jobs?limit=20` | `{items:[{id, kind, status, error, createdAt, model, user, trace, written}]}` |
| GET | `/api/jobs/:id/trace` (user, job của mình) và `/api/admin/jobs/:id/trace` | trace |

## Prewrite (người dùng)
`POST /api/ai/prewrite` body `{idea, kind:"image"|"video", skillId?, styleId?, cameraId?, aspect, durationSec?, hasRef?}` → `{key, status:"ready"|"pending"|"error"|"disabled", prompt?, skill?, provider?, model?, message?}`. Gọi lại cùng tham số → trả ready khi xong; `error` giữ 30 s sau lần viết lỗi; `disabled` khi `ai_roles.prewrite = false`; quá 2 lần viết nền / người → 429. Khóa: skill chỉ định (id+updatedAt) hoặc `auto` + phiên bản bộ skill (số skill + updatedAt lớn nhất); ảnh chỉ tính `styleId`, video chỉ `cameraId` (khớp preset của job). Cache giữ cả skill bộ chọn đã chọn (`route`) và `guard`. Job `autoWrite` dùng cache nếu khớp khóa (trace ghi `cache: true`); cùng khóa đang viết dở thì job chờ bản đó.

## Trace job (`params.trace`, ms epoch)
`{ createdAt, queuedAt, writeStart, writeEnd, writer:{provider, model, skill, cache, ms}, router?:{method:"rule"|"ai"|"fixed"|"fallback", candidates, chosen, ms}, guard?:{fixes}, slotAt, submitAt, engine:{provider, model, account?}, doneAt, failedAt?, error? }` — worker ghi từng mốc (jsonb merge nguyên tử); SSE `job` kèm `trace`. Engine file (agy/codex): `slotAt = submitAt` lúc gọi engine.

## `/api/admin/flow` (dữ liệu cho sơ đồ)
`{ nodes: [{id, kind:"user"|"api"|"queue"|"worker"|"gateway"|"skill"|"writer"|"executor"|"muse2api"|"muse-tab"|"validate"|"storage"|"realtime", title, subtitle, ai?: {provider, model, account?}, stats?: {...}}], edges: [{from, to, label?}], live: {queues:{...}, slots:{...}, activeJobs:[{id, kind, stage}]} }` — dựng từ cấu hình thật (ai_roles, model đang bật, tài khoản Muse/agy/codex, slot). Id nút: `user`, `api`, `queue:<muse|cli|post|story>`, `worker`, `gateway`, `skill`, `writer:<i>`, `story:<i>`, `router:<i>`, `exec:<modelId>`, `muse2api`, `muse-tab:<accountId>`, `validate`, `storage`, `realtime`. `live.slots = {limits: muse_slots, used: {image, video, chat}}`, `activeJobs[].stage` ∈ `waiting|queue|writing|slot|rendering`.
