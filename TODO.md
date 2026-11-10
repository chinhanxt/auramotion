# Việc còn dang dở

## Review cuối (chưa xong)

Lượt review cuối mới làm được một phần. Hai agent review bị dừng giữa chừng vì hết lượt dùng, đến 23h mới dùng lại được.

- **Review UI / tài liệu / script**: dừng giữa chừng, đã có 9 commit sửa trên nhánh `rv-ui`, **chưa gộp vào `dev2`**.
  Còn lại: quét chữ tiếng Anh sót trên UI, kiểm README / `.env.example` / `scripts/start-all.sh`, dọn code chết.
  Gộp: `git merge --squash rv-ui` trên `dev2` rồi chạy `npm test`.
- **Review backend**: chưa làm được gì. Cần làm lại toàn bộ:
  - Luồng createJob → hold → queue → processJob (MUSE/AGY/CODEX/LOCAL) → finishJob/failJob → charge/refund, sweeper, watchJob, cancel, retry.
  - Chặn theo gói ở server (Free: codex, video 10s, clone giọng).
  - Admin sửa options/giá/tắt model/xóa nhạc có làm hỏng job PENDING không.
  - Gỡ import vòng `src/server/services/job.ts` ↔ `worker/processors/assemble.ts`.
  - `/api/payments/[id]` chỉ trả trường cần thiết (bỏ `providerTxnId`, `confirmedBy`).
  - `worker/index.ts`: 3 hàng đợi, concurrency, cron, timeout hàng `post` 20 phút, shutdown sạch.

## Nghiệm thu thật (chinhan tự bấm, tốn lượt)

Task 19 Step 5: chạy với muse2api driver `browser`, agy, codex thật, ghi thời gian từng bước vào README.
