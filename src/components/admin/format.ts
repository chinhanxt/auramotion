// Định dạng + nhãn dùng chung cho trang quản trị (chạy được cả server lẫn client).
import type { Tone } from "@/components/ui/Bits";

export const PLAN_RANK_LABEL: Record<number, string> = { 0: "Free", 1: "Pro", 2: "Ultra" };

export const KIND_LABEL = { IMAGE: "Ảnh", VIDEO: "Video", ASSEMBLE: "Ghép" } as const;
export const KIND_ICON = { IMAGE: "image", VIDEO: "video", ASSEMBLE: "cut" } as const;

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
export const PAYMENT_STATUS_TONE: Record<keyof typeof PAYMENT_STATUS_LABEL, Tone> = { PENDING: "warn", SUCCEEDED: "ok", CANCELED: "neutral" };

export const STORY_TONE: Record<string, Tone> = {
  PLANNING: "info",
  READY: "aura",
  RENDERING: "info",
  ASSEMBLING: "info",
  DONE: "ok",
  FAILED: "danger",
  CANCELED: "neutral",
};

// Nhãn provider AI: dùng `providerLabel()` (src/lib/providers.ts) — agy → Google, codex → OpenAI, muse → Muse.
export { providerLabel } from "@/lib/providers";

export function formatVnd(value: number): string {
  return `${value.toLocaleString("vi-VN")} ₫`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN");
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return new Date(value).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
}

// "vừa xong", "5 phút", "3 giờ", "2 ngày" (trước / tới).
export function timeAgo(value: Date | string | number | null | undefined, now: number = Date.now()): string {
  if (value === null || value === undefined || value === "") return "—";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 45 ? null : abs < 3600 ? `${Math.round(abs / 60)} phút` : abs < 86400 ? `${Math.round(abs / 3600)} giờ` : `${Math.round(abs / 86400)} ngày`;
  if (!unit) return "vừa xong";
  return diff >= 0 ? `${unit} trước` : `còn ${unit}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function durationSec(start: Date | string | null | undefined, end: Date | string | null | undefined): number | null {
  if (!start || !end) return null;
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}
