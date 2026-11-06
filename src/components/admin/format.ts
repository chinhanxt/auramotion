// Định dạng dùng chung cho trang quản trị (chạy được cả server lẫn client).

export const PLAN_RANK_LABEL: Record<number, string> = { 0: "Free", 1: "Pro", 2: "Ultra" };

export const KIND_LABEL = { IMAGE: "Ảnh", VIDEO: "Video", ASSEMBLE: "Ghép video" } as const;

export const TXN_LABEL: Record<string, string> = {
  grant: "Cấp theo gói",
  purchase: "Mua thêm",
  hold: "Giữ",
  charge: "Trừ",
  refund: "Hoàn",
  admin_adjust: "Admin điều chỉnh",
  expire: "Hết hạn",
};

export const PAYMENT_STATUS_LABEL = { PENDING: "Chờ", SUCCEEDED: "Thành công", CANCELED: "Hủy" } as const;

export const PAYMENT_STATUS_COLOR = {
  PENDING: "bg-amber-100 text-amber-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  CANCELED: "bg-neutral-200 text-neutral-700",
} as const;

export function formatVnd(value: number): string {
  return `${value.toLocaleString("vi-VN")} ₫`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
}

export const buttonClass =
  "rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";
export const secondaryButtonClass =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-800 hover:bg-neutral-100 disabled:opacity-50";
export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900";
export const cardClass = "rounded-xl border border-neutral-200 bg-white p-4";
