// Mã lỗi job (cột `error`) → câu tiếng Việt cho người dùng (UI dùng jobErrorText với cùng mã).
export const JOB_ERROR_TEXT: Record<string, string> = {
  TIMEOUT: "quá thời gian xử lý",
  CANCELED: "tác vụ đã bị hủy",
  QUEUE_UNAVAILABLE: "hàng đợi đang lỗi",
  BAD_INPUT: "file đầu vào không còn",
  BAD_CLIP: "có clip không còn hoặc không hợp lệ",
  BAD_PARAMS: "tham số không hợp lệ",
  BAD_MEDIA: "file kết quả bị hỏng",
  NO_RESULT: "engine không trả kết quả",
  NO_IMAGE: "engine không trả ảnh",
  NO_AUDIO: "không tạo được giọng đọc",
  REFUSED: "nội dung bị từ chối, hãy đổi prompt",
  QUOTA: "engine tạm hết lượt",
  ASSEMBLE_FAILED: "ghép video lỗi",
  REGION_BLOCKED: "tài khoản Muse chưa tạo được video ở khu vực này",
  MUSE_VIDEO_UNAVAILABLE: "Muse tạm không tạo được video",
  FRAME_FAILED: "không lấy được khung cuối của cảnh trước",
  SHOT_FAILED: "có cảnh tạo lỗi",
  PLAN_FAILED: "AI chưa lập được kịch bản",
};

export function jobErrorText(code: string): string {
  return JOB_ERROR_TEXT[code] ?? `mã lỗi ${code}`;
}
