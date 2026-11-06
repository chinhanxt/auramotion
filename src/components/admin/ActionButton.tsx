"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { secondaryButtonClass } from "./format";

// Nút gọi một API (hủy, chạy lại, xóa, xác nhận…) rồi làm mới trang.
export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  confirmText,
  danger = false,
}: {
  url: string;
  method?: "POST" | "PATCH" | "DELETE";
  body?: unknown;
  label: string;
  confirmText?: string;
  danger?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    if (confirmText && !window.confirm(confirmText)) return;
    setError("");
    setPending(true);
    try {
      await api(url, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`${secondaryButtonClass} ${danger ? "border-red-300 text-red-700 hover:bg-red-50" : ""}`}
      >
        {pending ? "…" : label}
      </button>
      {error && <span className="max-w-48 text-xs text-red-700">{error}</span>}
    </span>
  );
}
