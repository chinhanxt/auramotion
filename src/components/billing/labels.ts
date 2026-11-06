import { formatCredit } from "@/lib/api-client";

export type PlanCode = "free" | "pro" | "ultra";
export type Period = "MONTH" | "YEAR";
export type PaymentStatus = "PENDING" | "SUCCEEDED" | "CANCELED";
export type CreditPack = { credits: number; price: number };

export type PaymentSummary = {
  id: string;
  type: "PLAN" | "CREDIT";
  planCode: PlanCode | null;
  period: Period | null;
  creditAmount: string | null;
  amount: number;
  refCode: string;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
};

export const TXN_LABEL: Record<string, string> = {
  grant: "Cấp Credit gói",
  purchase: "Mua Credit",
  hold: "Giữ Credit",
  charge: "Trừ Credit",
  refund: "Hoàn Credit",
  admin_adjust: "Admin điều chỉnh",
  expire: "Credit gói hết hạn",
};

export const JOB_KIND_LABEL: Record<string, string> = { IMAGE: "Tạo ảnh", VIDEO: "Tạo video", ASSEMBLE: "Ghép video" };

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Chờ thanh toán",
  SUCCEEDED: "Thành công",
  CANCELED: "Đã hủy",
};

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  CANCELED: "bg-neutral-200 text-neutral-700",
};

const PLAN_NAME: Record<PlanCode, string> = { free: "Free", pro: "Pro", ultra: "Ultra" };

export function formatVnd(amount: number): string {
  return `${amount.toLocaleString("vi-VN")}đ`;
}

export function formatDate(value: string | Date, withTime = true): string {
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    ...(withTime ? { timeStyle: "short" } : {}),
  });
}

export function paymentTitle(p: Pick<PaymentSummary, "type" | "planCode" | "period" | "creditAmount">): string {
  if (p.type === "PLAN") {
    return `Gói ${p.planCode ? PLAN_NAME[p.planCode] : ""} · ${p.period === "YEAR" ? "1 năm" : "1 tháng"}`;
  }
  return `${formatCredit(p.creditAmount ?? 0)} Credit`;
}
