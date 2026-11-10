# Việc còn dang dở

## Review backend (đã làm trên nhánh `v2-be`)

- [x] Luồng createJob → hold → queue → processJob → finishJob/failJob → charge/refund, sweeper, cancel, retry: đã rà, thêm kiểm file (ffprobe → `BAD_MEDIA`), tiến độ, sự kiện realtime.
- [x] Chặn theo gói ở server: codex (`minPlanRank`), video 10 s (`maxDurationSec`), giọng của tôi (rank ≥ 1, cả nghe thử), skill (`minPlanRank`), story kiểm thời lượng cảnh trước khi thu phí lập kịch bản, engine `maxRefs: 0` không nhận ảnh tham chiếu.
- [x] Admin sửa vs job PENDING: giá lưu trong job (`cost`), engine tắt / options đổi không làm hỏng job đã giữ Credit, preset đã dùng chỉ bị tắt, **xóa nhạc đang dùng cho job ghép chưa xong bị chặn (CONFLICT)**. Còn lại: sửa `promptSuffix` của preset áp vào job PENDING lúc chạy (chấp nhận).
- [x] Gỡ import vòng `services/job.ts` ↔ `worker/processors/assemble.ts`: ghép chuyển sang `src/server/services/assemble.ts` (`runAssembleJob` không gọi finishJob/failJob).
- [x] `/api/payments` và `/api/payments/[id]` chỉ trả trường cần thiết (bỏ `providerTxnId`, `confirmedBy`, `userId`).
- [x] `worker/index.ts`: 4 hàng đợi (muse, cli, post, story×2), Muse bận → dời job (không tính lần thử), lock 60 s, stalled tối đa 2 lần, timeout RUNNING muse 20 / cli 12 / post 20 phút, PENDING muse 90 phút, shutdown chờ 10 s rồi buộc đóng. Cron `sweepStories`: story kẹt PLANNING > 15 phút → FAILED + hoàn phí; story lỡ sự kiện → advance lại.

## Còn lại

- **Review UI / tài liệu / script** (nhánh `rv-ui` cũ): quét chữ tiếng Anh sót trên UI, kiểm `scripts/start-all.sh`, dọn code chết — việc của agent UI.
- **Nghiệm thu thật** (director chạy, tốn lượt): story PARALLEL 3 cảnh + CHAIN 3 cảnh với muse2api thật; đo thời gian lập kịch bản bằng chat chính; kiểm tiến độ `progress` hiện trên UI qua SSE; bìa preset bằng Muse.
- Ghép story: chưa có lồng tiếng / lời dẫn tự động (chỉ nhạc + giữ tiếng clip). Có skill `script-story-narration` để làm bước sau.
- Health gateway lưu trong Redis không có lịch sử (chỉ lần cuối).

## Nghiệm thu thật (chinhan tự bấm, tốn lượt)

Task 19 Step 5: chạy với muse2api driver `browser`, agy, codex thật, ghi thời gian từng bước vào README.
