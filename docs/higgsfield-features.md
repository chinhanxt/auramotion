# Phân tích chức năng Higgsfield.ai → áp dụng cho AuraMotion MVP

> Nguồn: REA `inspect_web_page` trên các trang công khai (`/`, `/pricing`, `/ai-video`) ngày 2026-11-06, chưa đăng nhập.
> Chỉ ghi nhận chức năng và mô hình kinh doanh, không lấy source/API nội bộ.

---

## 1. Kiến trúc sản phẩm tổng quát

Higgsfield là một **"aggregator"**: một giao diện gom nhiều model AI của bên thứ 3 + vài model tự làm, tính phí bằng **một loại credit chung**.

```
User → Chọn công cụ (Image / Video / Studio / Effect) → Chọn model → Prompt + tham chiếu
     → Trừ credit theo (model × độ phân giải × thời lượng) → Hàng đợi (giới hạn concurrent jobs theo gói)
     → Kết quả vào thư viện cá nhân → Có thể đăng lên Community
```

Menu chính: **Explore · Image · Video · Audio · Edit · Effects · Canvas · Studios · Community**

---

## 2. Danh sách chức năng đầy đủ

### 2.1 Tạo Ảnh (Image)
| Chức năng | Mô tả |
|---|---|
| Text-to-Image | Prompt → ảnh, chọn model |
| Multi Reference | Nhiều ảnh tham chiếu cho 1 lần tạo |
| Edit Image | Sửa ảnh bằng prompt |
| Inpaint | Tô vùng → sửa riêng vùng đó |
| Product Placement / Banana Placement | Đặt sản phẩm vào bối cảnh mới |
| Face Swap / Character Swap | Đổi mặt / đổi nhân vật |
| Upscale (Topaz) | Phóng to chất lượng cao, 4K |
| Presets (Soul Presets) | Phong cách dựng sẵn, bấm 1 lần |
| Character ID (Soul ID) | Huấn luyện 1 nhân vật nhất quán qua nhiều ảnh |
| Vector (Ideogram Vector) | Xuất ảnh vector |

Model ảnh: Nano Banana / Pro / 2, GPT Image 2–2.6, Seedream 4–5, Flux Kontext, FLUX.2 Pro/Flex/Max, Wan 2.2, Reve, Ideogram, Soul (model riêng).

### 2.2 Tạo Video (Video)
| Chức năng | Mô tả |
|---|---|
| Text-to-Video | Prompt → video |
| Image-to-Video | Ảnh phôi → video |
| First & Last frame | Khóa khung đầu + khung cuối |
| Video-to-Video / Edit video | Upload video → đổi style, thay vật thể |
| Motion Control | Video tham chiếu điều khiển chuyển động/cử chỉ |
| Camera Controls | Preset chuyển động camera (zoom, pan, xoay 3D, bullet time…) |
| Cinema Studio | Chọn thân máy, ống kính, tiêu cự (vd "35mm", "Anamorphic") |
| Effects / VFX | Thư viện hiệu ứng dựng sẵn (transitions, 3D rotation…) |
| Video Extender | Kéo dài video |
| Video Upscaler | Nâng độ phân giải |
| Video Background Remover | Tách nền |
| Lipsync Studio | Ghép khẩu hình theo audio |
| Talking Avatar / AI Influencer | Nhân vật nói, UGC |
| Có / không có âm thanh | Tùy chọn sinh kèm audio |

Tham số mỗi lần tạo: **model, độ phân giải (480p→4K), thời lượng (3–6s/clip), tỷ lệ khung, ảnh/video tham chiếu**.

Model video: Kling 2.5→4.0 / Omni, Seedance 1.5→2.5, Veo 3.1, Wan 2.2→3.0, Minimax Hailuo, Sora 2, Grok Video, DoP (model riêng).

### 2.3 Audio
- AI Voice Generator (TTS), Podcast Generator, Lipsync.

### 2.4 Studio (workflow đóng gói cho từng nhu cầu)
| Studio | Dùng cho |
|---|---|
| Marketing / Ads Studio | Video quảng cáo sản phẩm |
| Shorts Studio / Genjutsu | 1 video → nhiều biến thể cho Reels/TikTok |
| Faceless Studio, AI Explainer | Video không lộ mặt, video giải thích |
| Content Factory | Sản xuất hàng loạt |
| Mangaka | Truyện tranh |
| Popcorn | Chuỗi ảnh nhất quán (storyboard) |
| Canvas | Bảng node-based nối nhiều bước (ảnh → video → upscale) |
| Supercomputer | Agent AI tự lên kế hoạch & tạo nội dung theo yêu cầu |

### 2.5 Nền tảng & cộng đồng
- Community / Explore: feed tác phẩm công khai, Like, bộ sưu tập chọn lọc ("Picks").
- "Explore inside project": xem prompt/thiết lập của tác phẩm người khác → nhân bản.
- Contests, Creative Partners, Academy, Prompt Guide, Blog, Help Center.
- API, MCP/CLI (dùng từ Claude/ChatGPT), Browser extension.
- Đa ngôn ngữ, Enterprise / Business plan, team collab.

---

## 3. Mô hình Gói & Credit

| | Starter | Plus | Ultra |
|---|---|---|---|
| Giá (năm) | $15/th | $39/th | $99/th |
| Credit/tháng | 200 | 1.000 | 3.000 |
| Concurrent jobs | 2 | 4–6 | 8 |
| Unlimited 1 số model | ✗ | một phần | ✓ |

Ngoài ra: trả theo tháng / năm (năm rẻ ~20–30%), mua thêm credit lẻ, gói Business.

**Bảng giá credit theo tác vụ (mẫu):**

| Tác vụ | Credit |
|---|---|
| Ảnh model rẻ (Soul, Reve) | 0.12–0.25 / ảnh |
| Ảnh chuẩn (Nano Banana, Flux) | 1–2 / ảnh |
| Ảnh 4K / model cao cấp | 3–4 / ảnh |
| Face swap | ~2 / ảnh |
| Video rẻ (Seedance 1.5 480p) | ~1 / 5s |
| Video 720p phổ thông (Kling 3.0) | ~7 / 5s |
| Video 1080p | ~8–18 / 5s |
| Video 4K / model đắt (Veo 3.1, Seedance 2.0 4K) | 30–110 / 5s |

→ Điểm mấu chốt: **credit = f(model, độ phân giải, thời lượng, có âm thanh)**, không phải giá cố định.

Pricing page có **wizard chọn gói**: chọn mục đích (sản phẩm, cinematic, UGC, viral…) + số lượng nội dung/tháng → gợi ý gói.

---

## 4. Đối chiếu với plan.md & đề xuất cho MVP

### Sửa trong plan hiện tại
1. **Credit cố định (1 ảnh = 1, 1 video = 3) → bảng giá động**: bảng `credit_rules(task_type, model, resolution, duration_unit, cost)`. Admin chỉnh trong cổng quản trị. Credit dùng số thập phân.
2. **Phân biệt gói bằng concurrent jobs + độ phân giải tối đa + model được mở**, không chỉ số credit.
3. **Giữ credit tạm (hold) khi submit job → trừ thật khi xong → hoàn khi lỗi.** Higgsfield không nói, nhưng bắt buộc khi có hàng đợi.

### Thêm vào MVP (giá trị cao, công sức thấp)
- [ ] First/Last frame cho Image-to-Video.
- [ ] Preset style ảnh + preset camera video (đã có zoom/pan/360 → mở rộng thành thư viện).
- [ ] Upscale ảnh/video (gọi API có sẵn).
- [ ] Chọn độ phân giải + thời lượng, hiển thị **giá credit trước khi bấm Generate**.
- [ ] Lịch sử: lưu prompt + tham số → nút "Tạo lại / Nhân bản".
- [ ] Concurrent jobs limit theo gói.
- [ ] Trả tháng / năm + mua credit lẻ.

### Giai đoạn 2
- Multi-reference, Inpaint, Product placement, Face swap.
- Motion control, Video-to-Video edit, Extend video, Lipsync.
- Community feed + nhân bản prompt của người khác.
- Character ID (nhân vật nhất quán).

### Giai đoạn 3 (để sau)
- Canvas node-based, Agent tự động (kiểu Supercomputer), Studio đóng gói, API/MCP cho bên ngoài.

### Bổ sung Admin
- [ ] CRUD **danh sách model**: provider, tên, bật/tắt, gói nào được dùng, giá credit theo độ phân giải/thời lượng.
- [ ] CRUD **preset** (style ảnh, camera, effect) kèm ảnh/video demo.
- [ ] Cấu hình concurrent jobs + model mở khóa cho từng gói.
- [ ] Đối soát chi phí: credit thu của user vs tiền API thật trả cho provider (biên lợi nhuận theo model).
