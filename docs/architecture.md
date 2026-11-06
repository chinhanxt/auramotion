# Kiến Trúc Thư Mục

**Stack:** Next.js (App Router, TypeScript) · PostgreSQL + Prisma · Redis + BullMQ · Cloudflare R2 / S3.

Toàn bộ dự án là 1 repo, 1 app Next.js và 1 worker chạy riêng. Không có microservice.

```
auramotion/
├── docs/                     Tài liệu: kế hoạch, kiến trúc, phân tích
├── prisma/                   schema.prisma, migrations, seed.ts (gói, model, preset mặc định)
├── public/
│   └── presets/              Ảnh/video demo của preset
├── src/
│   ├── app/                  Định tuyến Next.js (trang + API)
│   │   ├── (auth)/           login, register, forgot-password
│   │   ├── (user)/           Khu vực người dùng (cần đăng nhập)
│   │   │   ├── studio/image  Tạo ảnh
│   │   │   ├── studio/video  Tạo video
│   │   │   ├── library       Thư viện kết quả
│   │   │   ├── credits       Số dư, lịch sử Credit & thanh toán
│   │   │   └── profile       Hồ sơ
│   │   ├── pricing/          Bảng giá (công khai)
│   │   ├── admin/            MUSE — chỉ role admin
│   │   │   ├── users         Người dùng, cộng/trừ Credit, khóa
│   │   │   ├── models        Model AI, bật/tắt, gói tối thiểu
│   │   │   ├── credit-rules  Giá Credit theo model × độ phân giải
│   │   │   ├── plans         Gói Free / Pro / Ultra
│   │   │   ├── presets       Preset phong cách & camera
│   │   │   ├── jobs          Hàng đợi, hủy / chạy lại, log lỗi
│   │   │   ├── payments      Đơn thanh toán, xác nhận QR
│   │   │   └── settings      API key, bảo trì
│   │   └── api/
│   │       ├── auth          Đăng nhập, OAuth
│   │       ├── jobs          Tạo job, xem trạng thái
│   │       ├── uploads       Upload ảnh tham chiếu (URL ký sẵn lên R2)
│   │       ├── credits       Số dư, báo giá trước khi tạo
│   │       ├── payments/webhook  Nhận xác nhận chuyển khoản
│   │       └── admin         API cho MUSE
│   ├── components/
│   │   ├── ui/               Nút, input, modal… dùng chung
│   │   ├── layout/           Header, sidebar, footer
│   │   ├── studio/           Ô prompt, chọn model, chọn tỷ lệ, preset, nút Tạo (hiện giá)
│   │   ├── library/          Lưới kết quả, trình xem ảnh/video
│   │   └── admin/            Bảng, form, biểu đồ cho MUSE
│   ├── server/               Logic chỉ chạy phía server (dùng chung cho app + worker)
│   │   ├── services/         credit (giữ/trừ/hoàn), pricing (tính giá), job, plan, payment
│   │   └── ai/               Adapter nhà cung cấp: mỗi nhà 1 file, chung interface generate()
│   ├── lib/                  Kết nối hạ tầng: db (Prisma), redis/queue, storage (R2), auth
│   └── types/                Kiểu dữ liệu dùng chung
├── worker/                   Tiến trình riêng: `node worker`
│   ├── processors/           Xử lý job tạo ảnh/video: gọi AI → lưu R2 → trừ/hoàn Credit
│   └── cron/                 Cấp Credit theo kỳ, hết hạn gói, xóa file Free sau 30 ngày
├── tests/
├── .env.example
└── README.md
```

## Quy tắc
- `app/` chỉ nhận request và trả về. Logic nghiệp vụ nằm trong `server/services`.
- Mọi thay đổi Credit đi qua `server/services/credit`, không ghi thẳng vào DB ở chỗ khác.
- Thêm model mới gồm 2 bước: thêm 1 file trong `server/ai/` và 1 dòng trong bảng `models`.
- `worker/` import `src/server` và `src/lib`, không import gì từ `app/` hay `components/`.

## Nhánh
- `main`: bản ổn định. Chỉ merge vào qua PR.
- `dev1`, `dev2`: nhánh phát triển song song, rẽ từ `main`.
