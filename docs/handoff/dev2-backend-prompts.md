# AuraMotion — bộ prompt nâng backend `dev2` lên ngang bản đang chạy (v2)

Dùng cho agent làm trên nhánh **dev1** (lấy code từ `dev2`, commit `55915a0`, MVP 06/11).
Mục tiêu: backend chạy **thật** với Muse / Google (agy) / OpenAI (codex) ổn định như bản v2 đang chạy trên máy chinhan (10/11/2026).

**Cách dùng:** đưa cho agent **từng bước một, đúng thứ tự**. Bước sau dựa trên bước trước. Mỗi bước có phần *Kiểm chứng* — chưa đạt thì chưa sang bước sau.
Mỗi prompt tự đủ thông tin (agent không xem được nhánh v2). Dán nguyên khối trong ``` ``` cho agent.

---

## Bước 0 — Luật chung (dán kèm MỌI bước)

```
Bối cảnh: AuraMotion = studio tạo ảnh/video AI (Next.js 15 App Router + Prisma/PostgreSQL :5433 + BullMQ/Redis :6379 + worker riêng `npm run worker`).
Engine: MUSE qua muse2api (HTTP, gateway giả lập web muse.ai bằng Chromium headless), Google qua CLI `agy`, OpenAI qua CLI `codex`, VieNeu + ffmpeg cho ghép video.

Luật làm việc:
- Chữ hiển thị & comment tiếng Việt, ngắn gọn. Commit nhỏ theo từng phần, message dạng `feat(x): ...` tiếng Việt. KHÔNG push nếu chưa được bảo.
- Máy 15 GB RAM đã sập vì chạy song song: mọi lệnh nặng (tsc, vitest, next build, prisma migrate/generate) chạy qua `flock /tmp/auramotion-heavy.lock <lệnh>`, không bật nhiều `next dev`.
- Không giết tiến trình bằng `pgrep -f <mẫu>` khi mẫu đó nằm trong chính dòng lệnh của bạn (từng tự giết shell). Dùng pidfile.
- Test bằng vitest với fake (script giả CLI/HTTP trong tests/fixtures), không gọi AI thật trong test. Gọi thật chỉ để kiểm chứng ngắn ở cuối bước.
- Không bao giờ in/log/trả token, refresh token, cookie.
- Xong mỗi bước: `npx tsc --noEmit` sạch + toàn bộ vitest xanh + phần "Kiểm chứng" thật.
```

---

## Bước 1 — Chạy thật trên 1 máy: muse2api riêng, script, Makefile

```
Mục tiêu: dựng môi trường chạy thật ổn định, bật/tắt bằng 1 lệnh.

Làm:
1. muse2api riêng cho AuraMotion (không dùng chung instance của dự án khác):
   - Cổng 18610, dữ liệu `data/muse2api`, CDP port riêng 19230, Chrome `/opt/google/chrome/chrome`, headless=true.
   - Biến .env (start script xuất toàn bộ .env): MUSE2API_DIR, MUSE_API_URL=http://127.0.0.1:18610, MUSE_API_KEY (openssl rand -hex 24),
     MUSE2API_CHROMIUM_PATH, MUSE2API_CDP_PORT=19230, MUSE2API_HEADLESS=true,
     MUSE2API_ACCOUNT_MAX_CONCURRENCY=5 (số tab = số "chat phụ" mỗi tài khoản), MUSE2API_VIDEO_TIMEOUT=900, MUSE2API_WARM_THREADS=1.
2. `scripts/muse2api.sh start|stop|restart|status`: chạy nền bằng setsid, pidfile `data/muse2api.pid`, log `data/logs/muse2api.log`, chờ `/healthz`; stop thì kill cả process group và Chrome còn sót của đúng cổng CDP.
3. `scripts/svc.sh start|stop|restart|status [app|worker|muse|all]`: app = `npm start` (bản build), worker = `npm run worker`, muse = gọi muse2api.sh. Pidfile `data/{app,worker}.pid`, log `data/logs/`. Khi stop app còn giải phóng tiến trình nào giữ cổng PORT.
4. `Makefile`: dev (migrate + muse2api + worker nền + `next dev -H 0.0.0.0` foreground, Ctrl+C dừng cả hai), start (build nếu thiếu `.next/BUILD_ID` rồi svc start), stop, restart (tsc → build → restart app+worker), status, logs, setup, test, check, url (in IP LAN).
5. Đặt `APP_URL` theo IP LAN (link email). NextAuth `trustHost: true` để vào bằng IP LAN được.

Kiểm chứng: `make start` → mở http://<IP-LAN>:3000, đăng nhập admin; `make status` thấy 3 dịch vụ; `make stop` dừng sạch (không còn next-server, worker, Chrome CDP 19230).
```

---

## Bước 2 — muse2api: chia việc theo tài khoản + ghim tài khoản (sửa trong repo muse2api)

```
Bối cảnh đo thật: tài khoản Muse có thể bị Muse chặn VIDEO theo vùng nhưng vẫn tạo ẢNH được
(trả lời dạng "video generation isn't available for this account in your country or region", mã muse2api `upstream_refused`).
Cần: 1 tài khoản chỉ ảnh + chat, 1 tài khoản chỉ video; và cho phép AuraMotion chọn đích danh tài khoản cho từng request.

Làm trong repo muse2api (Python FastAPI):
1. `accounts/pool.py`: thêm `allows_kind(acc, kind)` đọc `acc.meta["kinds"]` (vd ["image","chat"]; rỗng = mọi loại). `_candidates`, `_kind_blocked`, `has_alternative` bỏ qua tài khoản không cho kind đó.
2. `services/gateway.py`: truyền kind cho cả chat ("chat") và ảnh ("image") (trước chỉ video có kind).
3. `services/routing.py` (mới): middleware ASGI thuần đọc header `X-Muse-Account` (id hoặc label, decode utf-8) vào ContextVar `pinned_account`; pool chỉ chọn đúng tài khoản đó khi có ghim (ghim bỏ qua kinds). Đăng ký middleware trong `app.py`.
4. `api/schemas.py` AccountUpdate thêm `kinds: list[Literal["image","video","chat"]] | None`; PATCH `/admin/accounts/{id}` lưu `meta["kinds"]`.
5. Test pytest: kinds lọc đúng, ghim đúng tài khoản, has_alternative khi ghim.

Kiểm chứng thật: PATCH kinds cho 2 tài khoản; gửi `/v1/images/generations` với header X-Muse-Account → request log (`/admin/requests`) ghi đúng account_id; gửi video không ghim → luôn rơi vào tài khoản video.
Lưu ý: header HTTP từ Node không mang được chữ có dấu → AuraMotion luôn gửi ID tài khoản (acc_...), không gửi label.
```

---

## Bước 3 — AuraMotion: model ghim tài khoản Muse + chặn video theo vùng

```
Làm:
1. `AiModel.options.museAccount` (id muse2api). Engine muse gửi header `X-Muse-Account` khi có. Catalog trả cho trình duyệt phải BỎ trường museAccount.
2. Lỗi Muse từ chối video do vùng (regex /country or region|not available (for|in) (this account|your)/i trên message upstream_refused):
   EngineError mã `REGION_BLOCKED` KHÔNG retry (fail nhanh + hoàn Credit), đặt cờ Redis `am:muse:videoBlocked` {at,message} TTL 6 giờ.
   Khi cờ bật: createJob video MUSE trả AppError `MUSE_VIDEO_UNAVAILABLE` (503), catalog video trả `videoUnavailable: true`;
   import/renew tài khoản qua admin hoặc `POST /api/admin/muse/video-block/clear` gỡ cờ.
3. Proxy admin tới muse2api `/admin/*` (key MUSE2API_ADMIN_KEY || MUSE_API_KEY): list/import cookie JSON/PATCH (enabled,label,kinds)/DELETE/renew/quota/status.

Kiểm chứng: test fake cho REGION_BLOCKED không retry + hoàn Credit; thật: tạo 1 ảnh bằng model ghim → đúng tài khoản.
```

---

## Bước 4 — Bộ điều phối Muse (chat phụ) + kiểm file + tiến độ

```
Sự thật đo thật (10/11): ảnh 9:16 ~22–29 s; 3 video song song ở 3 chat phụ (gửi cách 15–20 s) ~61 s, file hợp lệ, không trùng;
gửi `size` cho video → Muse ra đúng tỷ lệ (9:16 → 720×1280, 1:1 → 960×960; không gửi size → 1280×720);
Muse đôi khi trả 10 s dù xin 5 s. Mỗi request media của muse2api = 1 thread mới ở 1 tab riêng (= "chat phụ").

Làm:
1. `src/server/engines/muse-scheduler.ts`: semaphore đếm bằng Redis ZSET (member=lease, score=hạn), Lua atomic acquire, lease 60 s, gia hạn mỗi 20 s, tự hết hạn khi worker chết.
   Loại slot: image / video / chat; giới hạn từ setting `muse_slots` mặc định `{image:2, video:3, chat:1, gapSec:15, sendVideoAspect:true}`;
   giãn cách tối thiểu gapSec giữa 2 lần gửi video (khóa Redis). Model ghim tài khoản có slot riêng theo tài khoản (key `sem:image@<acc>`).
   Hết slot → job quay lại hàng đợi sau waitMs, KHÔNG tính là 1 lần thử. Job đã có museTaskId (worker khởi động lại) → lấy lease kiểu force rồi poll tiếp.
2. Sau khi tải kết quả: ffprobe kiểm video có stream + duration>0, ảnh giải mã được; hỏng → EngineError `BAD_MEDIA` retryable. Lưu kích thước/thời lượng thật vào `params.result {width,height,durationSec}`.
3. `progress` của task muse2api → `Job.progress` (ghi thưa) + phát sự kiện.
4. Test: semaphore (giới hạn, giãn cách, lease chết, force), kiểm media.

Kiểm chứng thật: 3 video cùng lúc → chạy song song, xong ~1 phút, file hợp lệ; 2 ảnh trên 2 model Muse khác tài khoản chạy song song.
```

---

## Bước 5 — Realtime (SSE) thay polling

```
Làm: `src/lib/events.ts` publishEvent(userId, type, data) qua Redis pub/sub kênh `am:ev:<userId>`;
route `GET /api/events` (runtime nodejs, force-dynamic) — mỗi client 1 kết nối subscriber `redis.duplicate()`, ping 20 s, dọn khi client đóng.
Phát sự kiện `job` (status, progress, resultUrls, error, prompt, stage, written, trace), `story`, `credit` ở mọi chỗ đổi trạng thái/Credit.
Kiểm chứng: test publish; thật: mở 2 tab, tạo job ở tab 1 → tab 2 cập nhật không cần tải lại.
```

---

## Bước 6 — AI Gateway (viết prompt) + các bẫy CLI đã gặp

```
Mục tiêu: 1 cổng viết chữ cho mọi việc AI (viết prompt, chọn skill, lập kịch bản), tự chuyển provider khi lỗi.

Làm:
1. `src/server/ai/gateway.ts` `aiText({prompt, system?, json?, validate?, followUp?, provider?, threadKey?, signal})`:
   chuỗi provider agy → codex → muse (muse = muse2api `/v1/chat/completions` model muse-chat, field `user` = threadKey để giữ "chat chính").
   validate(text) ném lỗi → provider kế; với muse + threadKey: nhắn followUp 1 lần trong CÙNG thread trước khi chuyển.
   Health mỗi provider trong Redis (lastOkAt, lastErrAt, lastError, lastMs).
2. Hết quota: regex /quota|exhausted your capacity|resource[_ ]exhausted|rate limit|usage limit|\b429\b/i → cooldown theo KHÓA provider:model
   (`am:gw:cooldown:<provider>:<model>`), đọc "Resets in 2h34m33s", TỐI ĐA 30 phút, cứ 5 phút chạy 1 câu thử ngắn để gỡ sớm.
   (Đo thật: khóa cả agy 2,5 giờ là sai — vài phút sau model khác của agy vẫn chạy.) Test dùng prefix `am:test:` vì test dùng chung Redis với app.
3. Bẫy CLI đã gặp, phải xử lý:
   - Model agy cũ không còn (vd `claude-sonnet-4-6` từng nằm trong setting) → agy in "invalid model selection" + danh sách model dài → thử lại 1 lần với model mặc định.
   - Lỗi CLI chỉ giữ đuôi stderr thì mất lý do thật → giữ cả ĐẦU lẫn CUỐI.
   - agy chạy nhiều tiến trình song song làm đầu ra bị cắt / mất vỏ JSON `{status,response}` → (a) semaphore Redis giới hạn số tiến trình agy/codex (`am:cli:agy`, `am:cli:codex`, env AGY_CONCURRENCY/CODEX_CONCURRENCY mặc định 2) đặt trong `runCli`; (b) khi không có vỏ JSON thì trả nguyên văn cho bên gọi tự đọc.
   - Agent ảnh của agy trả "done" kể cả khi tool lỗi → sửa chỉ dẫn agent: lỗi thì trả "ERROR: <nguyên văn>"; nguyên văn chứa 429/exhausted → mã `QUOTA` không retry; "done" mà không có file → `NO_IMAGE` retryable.
   - `codex login status` in kết quả ra STDERR (stdout rỗng) → đọc cả 2 luồng.
4. JSON từ AI: bỏ ```json, chữ thừa, dấu phẩy thừa; với kịch bản Muse từng trả `"shots": {..}, {..}` thiếu `[` → sửa bằng quét ngoặc cân bằng.

Kiểm chứng: test fallback/health/cooldown; thật: gọi viết prompt 1 lần ra JSON hợp lệ, đo thời gian.
```

---

## Bước 7 — Tốc độ: agy chạy thường trực (ACP) + codex chạy thường trực (app-server)

```
Đo thật: agy CLI mỗi lần 1 tiến trình 6–10 s (cả câu "hi" 7 s); agy ACP mở phiên ~20–30 ms, model 2–4 s (gemini-3.8-flash-low ~4 s, claude-sonnet-5-5-low ~3.4 s);
codex exec effort low: gpt-6.1-sol 13,6 s, gpt-6-luna 7,2 s; codex app-server: khởi động 0,3 s, mở thread 0,4 s, model ~4,8 s.

Làm:
1. agy ACP: `agy acp --include-default-customizations=false --disable-telemetry --sandbox --gemini_dir <data>/agy-acp/gemini-N` (JSON-RPC 2.0 mỗi dòng qua stdio).
   Client: initialize → session/new (trả `models.availableModels` = danh sách model thật) → session/set_model → session/prompt (gom `session/update` agent_message_chunk) → session/close + xóa dữ liệu phiên.
   Từ chối mọi `session/request_permission`. Pool `AGY_ACP_PROCESSES` (mặc định 1, mỗi tiến trình nhiều phiên song song), khởi động lười, tự thay khi chết/không khỏe, tái chế sau N phiên.
   Tham khảo trên máy chinhan: `~/projects/eduvn/gateway/src/acp/{rpc,agent,pool}.ts` (chỉ đọc, có thể port).
   Gateway agy: ACP trước, ACP không lên → CLI.
2. codex app-server: `codex app-server` (JSON-RPC stdio; sinh schema bằng `codex app-server generate-json-schema --out <dir>`):
   initialize → thread/start (model, effort, sandbox read-only, không tool) → turn/start → gom agent message tới turn completed; từ chối mọi yêu cầu chạy lệnh/sửa file.
   1 tiến trình thường trực cho profile đang bật (CODEX_HOME), lỗi → về `codex exec`, 30 s sau mới thử lại.
   Quota: `account/rateLimits/read` → primary (5 giờ) / secondary (tuần): used_percent, window_minutes, resets_at; dự phòng đọc `rate_limits` mới nhất trong `CODEX_HOME/sessions/**/rollout-*.jsonl`.
3. Ghi breakdown thời gian start/session/model cho từng lần gọi.

Kiểm chứng thật: 1 câu ngắn qua ACP và qua app-server, in breakdown; tắt worker → không còn tiến trình agy acp / codex app-server sót.
```

---

## Bước 8 — Cấu hình vai trò AI (`ai_roles`) + viết trước (prewrite)

```
Làm:
1. Setting `ai_roles` (zod, đọc tương thích setting cũ `ai_gateway`/`prompt_writer`):
   writer.chain = [agy gemini-3.8-flash-low, codex gpt-6-luna effort low, muse], strategy "fallback"|"race" (race = 2 bước đầu chạy song song, ai hợp lệ trước thắng, hủy bên thua), timeoutSec 60;
   router.chain = [agy gemini-3.8-flash-low, codex gpt-6-luna low], timeout 20 s; story.chain = [muse, agy claude-sonnet-5-5-low], timeout 120;
   prewrite: true, cacheHours: 72; agy {transport:"acp", proxy:false}; codex {profile:"default"}. Mỗi bước chuỗi có provider, model, effort, profile.
2. Prewrite: `POST /api/ai/prewrite {idea, kind, skillId?, styleId?, cameraId?, aspect, durationSec?, hasRef?}` → {status: ready|pending|error|disabled, prompt, skill, provider}.
   Cache Redis theo sha256(skill id+updatedAt hoặc "auto"+phiên bản bộ skill, ý tưởng, style (ảnh) / camera (video), tỷ lệ, thời lượng, có ảnh, loại).
   Cùng khóa đang viết → trả pending, không viết lần 2. Tối đa 2 lần viết nền / người dùng.
   Kết quả: người dùng còn gõ thì AI đã viết; bấm Tạo → bước viết trong job ~60 ms (đo thật).

Kiểm chứng: test race/cache/dedupe; thật: prewrite → tạo job cùng tham số → trace ghi `writer.cache = true`.
```

---

## Bước 9 — Luồng chính: yêu cầu → AI Gateway (skill) → engine người dùng chọn

```
Luồng chinhan yêu cầu: người dùng gõ ý tưởng (tiếng Việt) + chọn model thực thi → AI Gateway chọn/áp skill viết prompt tiếng Anh → kiểm prompt → gửi đúng engine người dùng chọn → kết quả.

Làm:
1. Tham số job ảnh/video thêm `autoWrite?: boolean`, `skillId?: string` (bỏ = tự chọn). createJob kiểm skill hợp lệ + gói trước khi giữ Credit.
2. Worker `ensureWritten(job)` trước khi gửi engine: phát sự kiện stage "writing" → writePrompt({idea, kind, skillId, autoSkill, styleId|cameraId, aspect, duration, hasRef, planRank})
   → lưu job.prompt = prompt đã viết, `params.idea` = ý tưởng gốc, `params.written = {provider, skillSlug, skillName, ms, router, guard}` → stage "rendering".
   Đã viết rồi (BullMQ chạy lại) thì bỏ qua. Viết lỗi → FAILED `WRITE_FAILED` + hoàn Credit, KHÔNG gọi engine.
   Prompt đã viết thì không nối promptSuffix của style thêm lần nữa.
3. Có ảnh tham chiếu: AI viết không nhìn thấy ảnh → thêm ghi chú (ảnh: dùng chủ thể từ ảnh; video có khung đầu: chỉ tả chuyển động, không tả lại cảnh).
4. Trace job `params.trace` (ms epoch): createdAt, queuedAt, writeStart, writeEnd, writer{provider,model,skill,cache}, router{method,candidates,chosen,ms}, guard{fixes}, slotAt, submitAt, engine{provider,model,account}, doneAt/failedAt. Ghi bằng jsonb merge nguyên tử. API: `GET /api/jobs/:id/trace` (chủ job), `/api/admin/jobs/:id/trace`.

Kiểm chứng thật (đã chạy trên v2): 12 ca — ảnh Muse/Google/OpenAI + video Muse, có skill tự chọn và chỉ định, có ảnh khung đầu → 11/12 ra kết quả, lỗi duy nhất là tài khoản agy hết quota.
```

---

## Bước 10 — Thư viện skill (~60) + bộ chọn 2 tầng + kiểm prompt

```
Làm:
1. Prisma `PromptSkill`: slug, name, kind IMAGE|VIDEO|STORY|SCRIPT, description, category, tags String[] (từ khóa KHÔNG DẤU), instructions, template (biến {{idea}} {{style}} {{camera}} {{aspect}} {{duration}} {{shots}}), minPlanRank, enabled, sort.
   Seed tạo mới và CẬP NHẬT skill nào Admin chưa sửa (updatedAt≈createdAt), không đè skill Admin đã sửa.
2. Khối luật dùng chung ghép vào instructions:
   - INPUT_RULES: ý tưởng thường là tiếng Việt → viết prompt tiếng Anh tự nhiên; giữ mọi chi tiết người dùng đưa; văn hóa Việt gọi đúng tên (ao dai, conical non la hat, pho, banh mi, Hoi An lanterns, karst islands of Ha Long Bay); style dịch thành ngôn ngữ hình ảnh, không dán danh sách.
   - IMAGE_RULES: 1 đoạn 40–70 từ; thứ tự chủ thể → hành động → bối cảnh → ánh sáng → máy ảnh → mood; không chữ/logo trừ khi người dùng xin; không ghi tỷ lệ/độ phân giải.
   - VIDEO_RULES: 1–3 câu ngắn, hiện tại; ĐÚNG 1 chuyển động máy chậm/mượt, cấm zoom in-out lặp, rung, whip pan, cắt cảnh; chủ thể chuyển động liên tục; không ghi tỷ lệ/"vertical"/"4K"; nhân vật khóa bằng loài/kiểu người + 3–5 màu, lặp nguyên văn mỗi lần xuất hiện.
   - STORY_RULES: cảnh nối nhau (match-cut, khớp hình/màu/chuyển động), cùng họ bối cảnh/ánh sáng/bảng màu; JSON đúng `{"title","shots":[{"title","prompt","camera","durationSec"}]}`, đúng số cảnh.
   - Sản phẩm: nhãn/bao bì để trơn, không bịa thương hiệu (thật: codex từng tự in "MAISON ELORE PARIS").
3. Danh mục skill (category): Review sản phẩm (flat lay đập hộp, cầm tay UGC, video đập hộp, dùng thử, kịch bản review, lời review), Bán hàng (key visual khuyến mãi chừa chỗ chữ, ảnh nền trắng sàn TMĐT, hook 3 giây, b-roll UGC, xoay 360, kịch bản quảng cáo, lời livestream), Thời trang (lookbook, flat lay set đồ, video thời trang, trang sức), Gia dụng (đồ dùng trong nhà, nội thất, video thiết bị chạy, làm sạch satisfying), Làm đẹp, Công nghệ, Ẩm thực, Du lịch Việt Nam, Làm phim (khung điện ảnh, poster, cảnh mở, khoảnh khắc cảm xúc, hành động, phim ngắn 3 hồi), Vlog (thumbnail, khoảnh khắc, một ngày, food tour), Nhân vật, Thú cưng, Mẹ & bé, Bất động sản, Sự kiện/cưới, Thể thao, Giáo dục, Chung (1 chuyển động máy, làm ảnh chuyển động, nền loop). Mỗi skill: vai trò + luật chung + 3–5 gạch đầu dòng riêng lĩnh vực + tags.
4. Bộ chọn skill 2 tầng `src/server/ai/router.ts`:
   - Tầng 1 (luật, ~0 ms): chấm điểm số lần khớp tags (cụm 2+ từ ×2) + tên/lĩnh vực ×0,5 trên chữ đã bỏ dấu → top 10. Điểm ≥3 và ≥2× ứng viên 2 → chọn luôn.
   - Tầng 2: AI (vai router) đọc ý tưởng + 10 ứng viên (slug, tên, lĩnh vực, mô tả) → JSON {"slug","reason"}; trả bậy → dò slug trong chữ → vẫn bậy thì dùng tầng 1.
   - Video có ảnh khung đầu → skill "làm ảnh chuyển động" luôn.
   (Thật: 8/8 ý tưởng mơ hồ chọn đúng; bẫy: "giấy gói" từng khớp nhầm "giày" → dùng cụm từ cụ thể như "doi giay", "giay the thao".)
5. Kiểm prompt `src/server/ai/guard.ts` sau khi viết: bỏ vỏ markdown/"Prompt:", bỏ chữ tỷ lệ/độ phân giải (9:16, vertical framing, 4K…), thay zoom giật/máy rung bằng "one slow smooth dolly in", bỏ yêu cầu chữ/logo (trừ khi ý tưởng có chữ/logo/tiêu đề), rút gọn >1200 ký tự; trả danh sách đã sửa.

Kiểm chứng: test router (luật, AI, dự phòng, ≤10 ứng viên) + guard; thật: 8 ý tưởng nhiều lĩnh vực → in skill + cách chọn + thời gian.
```

---

## Bước 11 — Story (chat chính lập kịch bản, chat phụ quay song song)

```
Đo thật: Story 3 cảnh song song + tự ghép 139 s (ra 1080×1920 15 s); nối cảnh 287 s (nhân vật giữ nguyên qua cảnh).

Làm: model Story (idea, skillId, styleId, cameraId, aspect, shotCount 2–8, shotDurationSec 5|10, mode PARALLEL|CHAIN, autoRun, autoAssemble, status PLANNING|READY|RENDERING|ASSEMBLING|DONE|FAILED|CANCELED, plan Json, threadKey `story:<id>`).
- Lập kịch bản qua gateway vai `story` (Muse chat chính giữ thread theo threadKey); phí lập kịch bản giữ → trừ, lỗi → hoàn.
- Parse kịch bản: sửa JSON hỏng; BỎ CẢNH TRÙNG (thật: cảnh 3 từng lặp nguyên cảnh 1); thiếu cảnh → nhắn lại trong cùng thread "Return only valid JSON, shots must be an array. Exactly N distinct shots, no repeated shot."
- Render PARALLEL: 1 job VIDEO/cảnh, giữ Credit tất cả trong 1 transaction (thiếu thì không tạo cảnh nào), scheduler bước 4 lo song song.
  CHAIN: cảnh k+1 chỉ vào hàng đợi khi cảnh k xong, khung cuối cảnh k (ffmpeg) làm khung đầu cảnh k+1.
- Xong hết → autoAssemble tạo job ghép (nhạc/phụ đề/giọng tùy chọn) → DONE. Quay lại 1 cảnh, hủy story (hoàn Credit), cron dọn story kẹt.
Kiểm chứng thật: 1 story 3 cảnh song song + 1 story nối cảnh ra video cuối.
```

---

## Bước 12 — Danh mục model cho người dùng (chọn theo tên model)

```
Sự thật: model LLM của agy/codex chỉ "điều khiển" công cụ vẽ có sẵn; model nào vẽ được phải test thật.
Đã test thật 10/11 (prompt đèn lồng 1:1): Google gemini-3.8-flash-low 24 s / -medium 22 s / -high 24 s, gemini-4-argon-low 33 s; Anthropic (qua agy) claude-sonnet-5-5-low 21 s, claude-opus-5-5-low 20 s;
OpenAI (codex) gpt-6-luna 42 s, gpt-6.1-sol 44 s, gpt-6-astra 30 s, gpt-6.1-terra 32 s, gpt-6-sol 29 s, gpt-5.6-sol 37 s, gpt-5.6-terra 33 s, gpt-5.6-luna 29 s; Muse Image 21 s, Muse Video 45 s.
agy: ảnh khác nhau rõ theo model; codex: ảnh gần giống nhau (cùng công cụ vẽ). agy chỉ còn Claude 5.5 (không còn 4.6). Model codex khác nhau theo profile.

Làm:
1. `AiModel` thêm: vendor (muse|google|anthropic|openai|local), displayName, badge, description, etaSec, verified Json {ok, testedAt, ms, error?, sampleUrl?}, source (manual|synced).
2. Tên ngắn (hàm dùng chung server + client): bỏ tiền tố hãng; họ model chỉ có 1 phiên bản thì bỏ số (Astra, Argon, Opus, Sonnet), nhiều phiên bản thì kèm số (Sol 6.1, Sol 6, Sol 5.6, Terra 6.1, Luna 6…); Flash/Pro luôn kèm số ("Flash 3.8"); mức -low/-medium/-high thành badge Nhanh / Cân bằng / Kỹ. Seed chỉ đổi tên dòng có tên tự sinh cũ, giữ tên Admin sửa.
3. `POST /api/admin/models/sync`: lấy danh sách thật (agy qua ACP, codex hợp các profile đã đăng nhập bỏ model ẩn, Muse muse-image/muse-video) → tạo dòng mới TẮT sẵn, chạy lại không tạo trùng.
4. `POST /api/admin/models/:id/verify`: tạo thật 1 ảnh nhỏ (hoặc video 5 s với Muse) đúng model đó, không trừ Credit, khóa chống chạy trùng, lưu ảnh mẫu + thời gian; etaSec lấy từ kết quả.
5. `/api/catalog` trả các trường mới, sắp theo hãng Muse → Google → Anthropic → OpenAI.
6. Hiển thị KHÔNG bao giờ ghi "agy"/"codex": agy → Google, codex → OpenAI, muse → Muse (chỉ đổi hiển thị, id nội bộ giữ nguyên).
7. Ảnh chỉ 1 lựa chọn Muse (ghim tài khoản ảnh); tài khoản video để riêng cho video.

Kiểm chứng: test sync/verify/naming; thật: đồng bộ → bật vài model → verify → người dùng tạo ảnh bằng 1 model Google + 1 model OpenAI.
```

---

## Bước 13 — Tài khoản Google (agy) và OpenAI (codex), quota

```
Làm:
1. agy nhiều tài khoản qua antigravity-switcher (`~/tool-app/antigravity-switcher`, biến AGY_SWITCHER_DIR): script cầu nối `tools/agy/switcher_bridge.py` (chạy `python3 -I`) import switcher.py,
   lệnh JSON: status (email, active, quota theo nhóm gemini_5h/gemini_weekly/claude_5h/claude_weekly + reset), auth-url (PKCE, verifier giữ trong Redis 10 phút, đưa qua stdin), exchange <callback|mã>, switch <id|auto>, remove.
   Admin: thêm tài khoản 2 bước (lấy link Google → dán callback), đổi/tự chọn, gỡ; proxy xoay tài khoản riêng cổng 8901 (không đụng 8899/8900 của dự án khác), bật thì ACP nhận CLOUD_CODE_URL.
   Không tự đổi/đăng xuất tài khoản agy của chủ máy khi chưa hỏi (dùng chung cho dự án khác).
2. codex nhiều profile: `~/.codex` (default) + mọi thư mục `~/.codex_profiles/*` (tên có thể có dấu cách) + `data/codex/<tên>`; đăng nhập web bằng `codex login --device-auth` (bắt URL + mã từ output, theo dõi tới khi xong), logout, chọn profile đang dùng.
3. Quota hiển thị: agy mỗi tài khoản 2 cột Gemini | Claude (5 giờ + tuần, % còn lại, đếm ngược); codex mỗi profile 5 giờ + tuần (app-server, dự phòng log phiên), cache 5 phút (lần đầu hỏi 9 profile mất vài giây).
Kiểm chứng: `/api/admin/ai` trả đủ tài khoản + quota thật, KHÔNG chứa token nào (grep refresh_token / ya29.).
```

---

## Bước 14 — API sơ đồ luồng + nghiệm thu cuối

```
Làm:
1. `GET /api/admin/flow`: đồ thị dựng từ cấu hình THẬT: người dùng → API (giữ Credit) → BullMQ (muse/cli/post/story) → worker → AI Gateway → chọn skill (luật) → AI chọn skill (chuỗi router) → AI viết (chuỗi writer) → kiểm prompt → engine theo provider × loại (KHÔNG gán sẵn model — model do người dùng chọn) → muse2api → tài khoản Muse (chat phụ) → kiểm file → lưu → realtime.
   Kèm live: số job theo hàng đợi, slot đang dùng, job đang chạy ở node nào. `GET /api/admin/flow/jobs` = job gần đây có trace (để phát lại).
2. Nghiệm thu thật (ghi thời gian vào README), mục tiêu ngang v2:
   | Việc | Mục tiêu |
   |---|---|
   | Viết prompt (Google qua ACP) | 3–5 s; có prewrite → ~0,06 s lúc bấm Tạo |
   | Chọn skill (tầng AI) | ~2–3 s |
   | Ảnh Muse | 20–30 s |
   | Ảnh Google / OpenAI | 20–45 s |
   | Video Muse 5 s | ~45–60 s; 3 video song song ~61 s |
   | Story 3 cảnh song song + ghép | ~140 s |
   | Ghép 2 clip + 2 câu VieNeu + nhạc + phụ đề | ~72 s |
3. Chạy `make test`, `make check`, `make restart`, rồi tự bấm thử trên giao diện bằng tài khoản người dùng thường.
```
