# Kế Hoạch Chức Năng Dự Án MVP (AuraMotion AI Studio)

Hệ thống tạo ảnh/video AI đơn giản: người dùng mua gói → nhận Credit → nhập Prompt → tạo Ảnh/Video. Admin quản lý người dùng, giá Credit và model qua cổng quản trị (MUSE).

**Nguyên tắc:** không tự huấn luyện hay vận hành GPU. Hệ thống chỉ gọi API của các nhà cung cấp model (Kling, Veo, Seedance, Nano Banana, Flux…), tính phí bằng Credit và lưu kết quả.

---

## 0. Luồng Chính

```
Đăng ký → Nhận Credit gói Free
   → Chọn Tạo Ảnh / Tạo Video → Chọn model, tỷ lệ khung, độ phân giải, thời lượng
   → Nhập Prompt (+ ảnh tham chiếu nếu có) → Thấy trước giá Credit → Bấm Tạo
   → Hệ thống giữ Credit → Đưa vào hàng đợi → Gọi API model
   → Thành công: trừ Credit, lưu kết quả vào Thư viện
   → Thất bại: hoàn Credit, báo lỗi
```

---

## 1. Gói Dịch Vụ & Credit

### 1.1 Gói dịch vụ

| | Free | Pro | Ultra |
|---|---|---|---|
| Credit/tháng | 20 | 500 | 2.000 |
| Tác vụ chạy cùng lúc | 1 | 3 | 6 |
| Độ phân giải tối đa | 720p | 1080p | 4K |
| Model được dùng | Model cơ bản | Cơ bản + cao cấp | Tất cả |
| Watermark | Có | Không | Không |
| Ưu tiên hàng đợi | Thấp | Trung bình | Cao |

- Giá tiền, số Credit và giới hạn của từng gói do Admin cấu hình, không viết cứng trong code.
- Có hai kỳ thanh toán: tháng và năm (rẻ hơn khoảng 20%).
- Credit trong gói được cấp lại mỗi kỳ và không cộng dồn sang kỳ sau. Credit mua thêm thì không hết hạn.

### 1.2 Cách tính Credit

Giá Credit **phụ thuộc vào tác vụ**, không cố định:

```
Credit = Giá gốc của model × Hệ số độ phân giải × Số đơn vị thời lượng (chỉ áp dụng cho video)
```

Ví dụ mặc định (Admin chỉnh được):

| Tác vụ | Model cơ bản | Model cao cấp |
|---|---|---|
| Tạo 1 ảnh | 1 | 2 |
| Ảnh 4K | 2 | 4 |
| Video 5s 720p | 3 | 8 |
| Video 5s 1080p | 5 | 15 |
| Video 5s 4K | — | 30 |
| Upscale ảnh / video | 1 / 3 | — |

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
- [ ] Nhập Prompt.
- [ ] Chọn model (chỉ hiện model mà gói được dùng; model bị khóa thì gắn nhãn "Pro"/"Ultra").
- [ ] Chọn tỷ lệ khung: 1:1, 9:16, 16:9, 4:5.
- [ ] Chọn số ảnh mỗi lần: 1, 2 hoặc 4.
- [ ] Chọn Preset phong cách (Studio, Ngoài trời, Trên tay, Lifestyle…). Preset tự thêm phần mô tả vào prompt.
- [ ] Upload ảnh tham chiếu (tối đa 1 ảnh ở MVP).
- [ ] Xem kết quả, tải ảnh xuống, Upscale.

### 2.4 Tạo Video
- [ ] **Text-to-Video**: tạo video từ Prompt.
- [ ] **Image-to-Video**: upload ảnh sản phẩm làm khung đầu.
- [ ] **Khung đầu + khung cuối** (chỉ với model hỗ trợ).
- [ ] Chọn tỷ lệ khung: 9:16 (TikTok/Reels/Shorts), 16:9 (YouTube), 1:1 (Instagram).
- [ ] Chọn thời lượng: 5s hoặc 10s.
- [ ] Chọn độ phân giải theo giới hạn gói: 720p / 1080p / 4K.
- [ ] Chọn Preset chuyển động camera: Zoom In, Zoom Out, Pan trái/phải, Xoay 360, Tĩnh.
- [ ] Bật/tắt âm thanh (chỉ với model hỗ trợ).
- [ ] Xem video bằng trình phát, tải MP4.

### 2.5 Thư viện (Projects)
- [ ] Danh sách ảnh/video đã tạo dạng lưới, lọc theo Ảnh / Video.
- [ ] Trạng thái từng tác vụ: Đang chờ → Đang xử lý → Hoàn tất / Thất bại (tự cập nhật bằng polling hoặc SSE).
- [ ] Xem chi tiết: Prompt, model, các thiết lập, số Credit đã tốn.
- [ ] **Tạo lại**: mở form với đúng các thiết lập cũ.
- [ ] Xóa kết quả.
- [ ] Kết quả gói Free lưu 30 ngày, gói trả phí lưu vĩnh viễn.

---

## 3. Phân Hệ Quản Trị (Admin / MUSE)

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

### 3.3 Cấu hình (MUSE)
- [ ] **Model**: thêm, sửa, bật/tắt model. Thông tin của mỗi model: nhà cung cấp, loại (ảnh/video), gói tối thiểu, độ phân giải và thời lượng hỗ trợ, có hỗ trợ khung cuối/âm thanh không.
- [ ] **Bảng giá Credit**: giá gốc từng model, hệ số theo độ phân giải.
- [ ] **Gói dịch vụ**: giá, Credit/tháng, số tác vụ chạy cùng lúc, độ phân giải tối đa.
- [ ] **Preset**: thêm/sửa preset phong cách và camera, gồm tên, ảnh demo, đoạn prompt thêm vào.
- [ ] **API Key nhà cung cấp**: lưu mã hóa, test kết nối.
- [ ] Bật/tắt chế độ bảo trì.

### 3.4 Hàng đợi & Lỗi
- [ ] Danh sách tác vụ: lọc theo trạng thái, người dùng, model.
- [ ] Hủy tác vụ bị treo (tự hoàn Credit), chạy lại tác vụ lỗi.
- [ ] Nhật ký lỗi: lỗi nhà cung cấp trả về và lỗi hệ thống.

### 3.5 Thanh toán
- [ ] Danh sách đơn thanh toán với các trạng thái: Chờ / Thành công / Hủy.
- [ ] Xác nhận đơn QR thủ công khi webhook không khớp.
- [ ] Báo cáo doanh thu theo ngày/tháng.
- [ ] Báo cáo chi phí API theo model, so với Credit thu được, để biết lãi/lỗ của từng model.

---

## 4. Dữ Liệu Chính (tối giản)

| Bảng | Trường chính |
|---|---|
| `users` | id, email, password_hash, google_id, name, role (user/admin), status, created_at |
| `plans` | id, code (free/pro/ultra), price_month, price_year, monthly_credits, max_concurrent, max_resolution |
| `subscriptions` | id, user_id, plan_id, period (month/year), start_at, end_at, status |
| `credit_transactions` | id, user_id, type, amount, job_id, note, created_at |
| `models` | id, name, provider, kind (image/video), min_plan, base_cost, options (JSON), enabled |
| `presets` | id, kind (style/camera), name, prompt_suffix, thumbnail, enabled |
| `jobs` | id, user_id, model_id, kind, prompt, params (JSON), input_url, status, cost, result_urls, error, created_at, finished_at |
| `payments` | id, user_id, type (plan/credit), amount, ref_code, status, created_at |
| `settings` | key, value (hệ số độ phân giải, chế độ bảo trì, API key mã hóa…) |

---

## 5. Kỹ Thuật (đề xuất gọn)

- **Frontend + Backend**: Next.js (App Router + API routes) hoặc FastAPI + React. Chọn một, không tách microservice.
- **DB**: PostgreSQL. **Hàng đợi**: Redis + 1 worker (BullMQ / RQ).
- **Lưu file**: S3 / Cloudflare R2.
- **Worker**: lấy job → gọi API nhà cung cấp → poll kết quả → tải file về R2 → cập nhật job và Credit.
- **Adapter model**: mỗi nhà cung cấp là 1 file, cùng chung interface `generate(params) → result_urls`. Muốn thêm model thì chỉ thêm 1 adapter và 1 dòng trong bảng `models`.
- Giới hạn tác vụ chạy cùng lúc: đếm các job `pending`/`running` của user, so với `plans.max_concurrent`.

---

## 6. Lộ Trình

### Giai đoạn 1 — MVP (bắt buộc)
- Tài khoản, 3 gói, Credit giữ/trừ/hoàn, QR thanh toán.
- Tạo Ảnh (Text-to-Image + 1 ảnh tham chiếu + Preset).
- Tạo Video (Text-to-Video, Image-to-Video, Preset camera).
- Thư viện + Tạo lại.
- Admin: người dùng, model, bảng giá, gói, preset, hàng đợi, thanh toán, dashboard.
- Tích hợp 1 model ảnh + 1 model video. Thêm model sau.

### Giai đoạn 2 — Mở rộng
- Khung đầu/cuối, Upscale, Bật âm thanh.
- Nhiều ảnh tham chiếu, Inpaint (sửa vùng ảnh), Đặt sản phẩm vào bối cảnh.
- Lồng tiếng AI (TTS) + phụ đề tự động.
- Kéo dài video, Video-to-Video.

### Giai đoạn 3 — Sau này
- Cộng đồng (feed công khai, sao chép prompt của người khác).
- Nhân vật nhất quán (Character ID), Lipsync, Face swap.
- API cho bên ngoài, gói doanh nghiệp/nhóm.
