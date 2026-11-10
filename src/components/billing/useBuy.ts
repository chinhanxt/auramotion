"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { ApiError, postJson } from "@/lib/api-client";
import type { Period } from "./labels";

// Client chỉ gửi loại gói / số Credit; số tiền do server tính từ DB.
export type OrderBody = { type: "PLAN"; planCode: "pro" | "ultra"; period: Period } | { type: "CREDIT"; credits: number };

export function useBuy(returnTo: string) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function buy(key: string, order: OrderBody) {
    setBusy(key);
    try {
      const payment = await postJson<{ id: string }>("/api/payments", order);
      router.push(`/credits/pay/${payment.id}`);
    } catch (err) {
      setBusy(null);
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") {
        router.push(`/login?callbackUrl=${encodeURIComponent(returnTo)}`);
        return;
      }
      toast.error((err as Error).message);
    }
  }

  return { buy, busy };
}
