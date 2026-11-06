# Kế Hoạch Chức Năng Dự Án MVP (AuraMotion AI Studio)

Hệ thống tạo ảnh/video AI đơn giản: người dùng mua gói → nhận Credit → nhập Prompt (AI viết hộ được) → tạo Ảnh/Video → ghép thành video hoàn chỉnh có giọng đọc, nhạc, phụ đề. Admin quản lý người dùng, giá Credit và cấu hình qua cổng quản trị.

**MVP đồ án, chạy trên 1 máy**, ít người dùng: chọn cách đơn giản nhất chạy được trên một máy.

| Việc | Engine |
|---|---|
| Viết prompt | CLI **agy** (Gemini, Claude) hoặc **codex**, chạy trong thư mục tạm, xong thì xóa phiên |
| Tạo ảnh | CLI **agy** (`generate_image`) hoặc **codex** (công cụ ảnh có sẵn), hoặc **MUSE** |
| Tạo video | **MUSE** qua [muse2api](https://github.com/www222fff/muse2api) (service riêng, API chuẩn OpenAI) |
| Giọng đọc | **VieNeu-TTS v3 Turbo** (`vieneu-say`, CPU) — [voice-vieneu.md](voice-vieneu.md) |
| Ghép video | `tools/post/assemble.py` (ffmpeg) — [post-production.md](post-production.md) |

**Nguyên tắc:** web app không tự chạy AI. App nhận yêu cầu, tính và giữ Credit, đưa job vào hàng đợi; worker chạy engine tương ứng rồi lưu kết quả và trừ / hoàn Credit.

**MUSE hỗ trợ:**
- Ảnh: prompt, tỷ lệ khung, 1–4 ảnh mỗi lần, tối đa 4 ảnh tham chiếu.
- Video: prompt, tỷ lệ khung, thời lượng, 1 ảnh khung đầu.
- Không có tham số độ phân giải, chất lượng, âm thanh. Các gói vì vậy không phân theo độ phân giải.

---

## 0. Luồng Chính

```
Đăng ký → Nhận Credit gói Free
   → Chọn Tạo Ảnh / Tạo Video → Chọn tỷ lệ khung, số ảnh hoặc thời lượng, preset
   → Nhập Prompt (+ ảnh tham chiếu nếu có) → Thấy trước giá Credit → Bấm Tạo
   → Hệ thống giữ Credit → Đưa vào hàng đợi → Worker gọi engine (agy / codex / MUSE)
   → Thành công: trừ Credit, lưu kết quả vào Thư viện
   → Thất bại: hoàn Credit, báo lỗi
   → Ghép video: chọn ảnh/video trong Thư viện + lời thoại + giọng + nhạc → video hoàn chỉnh
```

---

## 1. Gói Dịch Vụ & Credit

### 1.1 Gói dịch vụ

| | Free | Pro | Ultra |
|---|---|---|---|
| Credit/tháng | 20 | 500 | 2.000 |
| Tác vụ chạy cùng lúc | 1 | 3 | 6 |
| Thời lượng video tối đa | 5s | 10s | 10s |
| Lưu kết quả | 30 ngày | Vĩnh viễn | Vĩnh viễn |
| Watermark (giai đoạn 2) | Có | Không | Không |
| Ưu tiên hàng đợi | Thấp | Trung bình | Cao |

- Giá tiền, số Credit và giới hạn của từng gói do Admin cấu hình, không viết cứng trong code.
- Có hai kỳ thanh toán: tháng và năm (rẻ hơn khoảng 20%).
- Credit trong gói được cấp lại mỗi kỳ và không cộng dồn sang kỳ sau. Credit mua thêm thì không hết hạn.

### 1.2 Cách tính Credit

Giá Credit **phụ thuộc vào tác vụ**, không cố định:

```
Ảnh:      Credit = Giá gốc engine ảnh × Số ảnh
Video:    Credit = Giá gốc video × (Thời lượng / 5)
Ghép:     Credit = Giá gốc ghép + Số câu lời thoại × Giá mỗi câu
Viết prompt bằng AI: miễn phí
```

Mặc định (Admin chỉnh được):

| Tác vụ | Credit |
|---|---|
| 1 ảnh MUSE / agy | 1 |
| 1 ảnh codex (chỉ gói Pro trở lên) | 2 |
| 4 ảnh MUSE | 4 |
| Video 5s | 3 |
| Video 10s | 6 |
| Ghép video, 3 câu thoại | 2 + 3 × 1 = 5 |

- Credit là số thập phân, lưu với 2 chữ số sau dấu phẩy.
- Giá Credit luôn **hiển thị trên nút Tạo** trước khi người dùng bấm.

### 1.3 Giao dịch Credit
Credit có 3 bước: **Giữ → Trừ hoặc Hoàn**.
- [ ] Khi bấm Tạo: kiểm tra số dư, rồi giữ Credit (số dư khả dụng giảm ngay).
- [ ] Khi job thành công: chuyển Credit đang giữ thành đã trừ.
- [ ] Khi job thất bại hoặc quá thời gian: hoàn Credit đang giữ.
- [ ] Mọi biến động đều ghi vào sổ `credit_transactions`, gồm các loại: `grant` (cấp theo gói), `purchase` (mua thêm), `hold`, `charge`, `refund`, `admin_adjust`.
- [ ] Số dư = tổng các giao dịch trong sổ. Không có chỗ nào sửa trực tiếp số dư.

---

## 2. Phân Hệ Người Dùng

### 2.1 Tài khoản
- [ ] Đăng ký, đăng nhập bằng Email/Password và Google OAuth.
- [ ] Quên mật khẩu, đặt lại mật khẩu qua email.
- [ ] Hồ sơ cá nhân: tên, avatar, đổi mật khẩu.
- [ ] Tài khoản mới tự nhận gói Free và Credit Free.

### 2.2 Gói & Thanh toán
- [ ] Trang Pricing: so sánh 3 gói, chuyển đổi tháng/năm.
- [ ] Nâng cấp gói qua QR chuyển khoản. Hệ thống tự đối soát qua webhook ngân hàng/cổng thanh toán, hoặc Admin xác nhận thủ công.
- [ ] Mua thêm gói Credit lẻ (ví dụ 100 / 500 / 1.000 Credit).
- [ ] Hết hạn gói thì tự về gói Free. Nhắc gia hạn trước 3 ngày.
- [ ] Trang Credit: số dư, Credit đang giữ, lịch sử giao dịch, lịch sử thanh toán.

### 2.3 Tạo Ảnh
- [ ] Nhập Prompt. Nút **AI viết prompt**: gõ ý tưởng tiếng Việt → AI (agy / codex) trả prompt tiếng Anh vào ô.
- [ ] Chọn engine: MUSE, Gemini (agy), Codex. Engine bị khóa theo gói thì gắn nhãn "Pro".
- [ ] Chọn tỷ lệ khung: 1:1, 9:16, 16:9, 4:5.
- [ ] Chọn số ảnh mỗi lần: 1, 2 hoặc 4 (MUSE). agy / codex: 1 ảnh mỗi lần (mỗi ảnh 1–4 phút).
- [ ] Chọn Preset phong cách (Studio, Ngoài trời, Trên tay, Lifestyle…). Preset tự thêm phần mô tả vào prompt.
- [ ] Upload ảnh tham chiếu (tối đa 1 ảnh ở MVP).
- [ ] Xem kết quả, tải ảnh xuống.

### 2.4 Tạo Video
- [ ] **Text-to-Video**: tạo video từ Prompt (có nút AI viết prompt).
- [ ] **Image-to-Video**: upload ảnh sản phẩm làm khung đầu.
- [ ] Chọn tỷ lệ khung: 9:16 (TikTok/Reels/Shorts), 16:9 (YouTube), 1:1 (Instagram).
- [ ] Chọn thời lượng: 5s hoặc 10s (theo giới hạn gói).
- [ ] Chọn Preset chuyển động camera: Zoom In, Zoom Out, Pan trái/phải, Xoay 360, Tĩnh.
- [ ] Xem video bằng trình phát, tải MP4.

### 2.5 Thư viện (Projects)
- [ ] Danh sách ảnh/video đã tạo dạng lưới, lọc theo Ảnh / Video.
- [ ] Trạng thái từng tác vụ: Đang chờ → Đang xử lý → Hoàn tất / Thất bại (tự cập nhật bằng polling hoặc SSE).
- [ ] Xem chi tiết: Prompt, model, các thiết lập, số Credit đã tốn.
- [ ] **Tạo lại**: mở form với đúng các thiết lập cũ.
- [ ] Xóa kết quả.
- [ ] Kết quả gói Free lưu 30 ngày, gói trả phí lưu vĩnh viễn.

### 2.6 Ghép video (hậu kỳ)
- [ ] Chọn và sắp thứ tự ảnh / video đã tạo trong Thư viện (ảnh tĩnh thành clip zoom chậm, chọn số giây).
- [ ] Nhập lời thoại, mỗi dòng 1 câu (có nút AI viết lời thoại từ mô tả sản phẩm).
- [ ] Chọn giọng VieNeu có sẵn (nghe thử) hoặc upload audio mẫu 3–8 giây để clone giọng (gói Pro trở lên).
- [ ] Chọn nhạc nền CC0 có sẵn hoặc không nhạc; bật/tắt phụ đề; giữ hay tắt tiếng gốc của clip.
- [ ] Kết quả MP4 vào Thư viện như một mục loại "Video ghép".

---

## 3. Phân Hệ Quản Trị (Admin)

### 3.1 Dashboard
- [ ] Số liệu hôm nay, 7 ngày, 30 ngày: người dùng mới, số ảnh/video đã tạo, Credit đã tiêu, doanh thu.
- [ ] Biểu đồ số lượt tạo theo ngày.
- [ ] Tỷ lệ người dùng theo gói Free / Pro / Ultra.

### 3.2 Quản lý người dùng
- [ ] Danh sách người dùng: tìm theo email, lọc theo gói.
- [ ] Chi tiết người dùng: gói, số dư, lịch sử Credit, lịch sử tạo.
- [ ] Cộng/trừ Credit thủ công, bắt buộc nhập lý do.
- [ ] Đổi gói thủ công.
- [ ] Khóa / mở khóa tài khoản.

### 3.3 Cấu hình
- [ ] **Engine / model**: bật/tắt, tên hiển thị, gói tối thiểu, tham số hỗ trợ của từng engine (MUSE ảnh, MUSE video, Gemini agy, Codex, Ghép video). Chọn model agy dùng để viết prompt.
- [ ] **Bảng giá Credit**: giá gốc từng engine, giá mỗi câu lời thoại.
- [ ] **Nhạc nền**: danh sách bài CC0 trong `public/music`.
- [ ] **Gói dịch vụ**: giá, Credit/tháng, số tác vụ chạy cùng lúc, thời lượng video tối đa.
- [ ] **Preset**: thêm/sửa preset phong cách và camera, gồm tên, ảnh demo, đoạn prompt thêm vào.
- [ ] **Kết nối MUSE**: xem trạng thái muse2api (`/readyz`: driver, số tài khoản Muse khả dụng), nút test kết nối. URL và API key muse2api để trong biến môi trường.
- [ ] Bật/tắt chế độ bảo trì.

### 3.4 Hàng đợi & Lỗi
- [ ] Danh sách tác vụ: lọc theo trạng thái, người dùng, model.
- [ ] Hủy tác vụ bị treo (tự hoàn Credit), chạy lại tác vụ lỗi.
- [ ] Nhật ký lỗi: lỗi MUSE trả về và lỗi hệ thống.
- [ ] Thời gian xử lý trung bình của MUSE theo loại tác vụ.

### 3.5 Thanh toán
- [ ] Danh sách đơn thanh toán với các trạng thái: Chờ / Thành công / Hủy.
- [ ] Xác nhận đơn QR thủ công khi webhook không khớp.
- [ ] Báo cáo doanh thu theo ngày/tháng.
- [ ] Báo cáo Credit tiêu thụ theo model MUSE và theo loại tác vụ.

---

## 4. Dữ Liệu Chính (tối giản)

| Bảng | Trường chính |
|---|---|
| `users` | id, email, password_hash, google_id, name, role (user/admin), status, created_at |
| `plans` | id, code (free/pro/ultra), price_month, price_year, monthly_credits, max_concurrent, max_duration_sec |
| `subscriptions` | id, user_id, plan_id, period (month/year), start_at, end_at, status |
| `credit_transactions` | id, user_id, type, amount, job_id, note, created_at |
| `models` | id, name, provider (muse/agy/codex/local), engine_model, kind (image/video/assemble), min_plan, base_cost, options (JSON), enabled |
| `presets` | id, kind (style/camera), name, prompt_suffix, thumbnail, enabled |
| `jobs` | id, user_id, model_id, kind (image/video/assemble), prompt, params (JSON: tham số tạo hoặc kịch bản ghép), input_url, status, cost, result_urls, error, created_at, finished_at |
| `payments` | id, user_id, type (plan/credit), amount, ref_code, status, created_at |
| `settings` | key, value (chế độ bảo trì, gói Credit lẻ…) |

---

## 5. Kỹ Thuật (đề xuất gọn)

- **Frontend + Backend**: Next.js (App Router + API routes), không tách microservice. Chi tiết thư mục xem [architecture.md](architecture.md).
- **DB**: PostgreSQL. **Hàng đợi**: Redis + BullMQ, 3 hàng đợi: `muse` (theo số tài khoản Muse), `cli` (agy / codex, 1 lúc 1 lệnh), `post` (ghép video, 1 lúc 1 việc vì VieNeu chạy CPU).
- **Lưu file**: ổ đĩa của máy (`STORAGE_DIR`), app phục vụ qua `/media/...`. Không cần S3 / R2 vì chạy 1 máy.
- **MUSE**: muse2api chạy native (venv Python, cần Chromium) cạnh app. Dev và test dùng `MUSE2API_DRIVER=mock`; chạy thật dùng driver `browser`. Script `scripts/muse-keepalive.sh` gia hạn phiên tài khoản Muse.
- **Worker** chạy native trên máy (cần `agy`, `codex`, `vieneu-say`, `ffmpeg` đã đăng nhập / cài sẵn). Postgres + Redis chạy bằng docker-compose.
- **Engine**: `src/server/engines/` — `muse` (submit + poll muse2api), `agy` và `codex` (chạy CLI trong thư mục tạm, xong thì xóa phiên), `assemble` (gọi `tools/post/assemble.py`).
- Giới hạn tác vụ chạy cùng lúc: đếm các job `pending`/`running` của user, so với `plans.max_concurrent`.

---

## 6. Lộ Trình

### Giai đoạn 1 — MVP (bắt buộc)
- Tài khoản, 3 gói, Credit giữ/trừ/hoàn, QR thanh toán (xác nhận tay + webhook).
- Tạo Ảnh: MUSE / agy / codex, 1 ảnh tham chiếu, Preset, AI viết prompt.
- Tạo Video: MUSE, Text-to-Video, Image-to-Video, Preset camera, AI viết prompt.
- Ghép video: clip + giọng VieNeu (có sẵn / clone) + nhạc CC0 + phụ đề.
- Thư viện + Tạo lại.
- Admin: người dùng, engine, bảng giá, gói, preset, nhạc, hàng đợi, thanh toán, dashboard.

### Giai đoạn 2 — Mở rộng
- Watermark gói Free, chuyển cảnh `xfade`, chữ hook đầu video, CTA cuối.
- Nhiều ảnh tham chiếu (tối đa 4), ghép sản phẩm vào bối cảnh, ảnh nền trong suốt.
- VieNeu chạy GPU ([voice-vieneu.md](voice-vieneu.md)).
- Kéo dài video, Video-to-Video.

### Giai đoạn 3 — Sau này
- Cộng đồng (feed công khai, sao chép prompt của người khác).
- Nhân vật nhất quán (Character ID), Lipsync, Face swap.
- API cho bên ngoài, gói doanh nghiệp/nhóm.
