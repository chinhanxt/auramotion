"use client";

import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { ApiError, planLabel } from "@/lib/api-client";

export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError("INTERNAL", (err as Error).message, 0);
}

// Câu ngắn cho lỗi API thường gặp; minRank = gói thấp nhất của engine.
export function describeError(err: ApiError, minRank = 1): { title: string; action?: { label: string; href: string } } {
  if (err.code === "INSUFFICIENT_CREDIT") return { title: "Không đủ Credit", action: { label: "Nạp", href: "/credits" } };
  if (err.code === "MAINTENANCE") return { title: "Hệ thống đang bảo trì, quay lại sau" };
  if (err.code.startsWith("PLAN_")) return { title: `Cần gói ${planLabel(minRank)}`, action: { label: "Bảng giá", href: "/pricing" } };
  if (err.code === "CONCURRENCY_LIMIT") return { title: err.message || "Đang có tác vụ chạy, chờ chút" };
  return { title: err.message };
}

export function useErrorToast() {
  const toast = useToast();
  return useCallback(
    (err: unknown, minRank?: number) => {
      if ((err as Error)?.name === "AbortError") return;
      const d = describeError(toApiError(err), minRank);
      toast.error(d.title, d.action ? { action: d.action } : undefined);
    },
    [toast],
  );
}
