"use client";

import { formatCredit } from "@/lib/api-client";

export function GenerateButton({
  cost,
  quoting,
  pending,
  disabled,
  label = "Tạo",
}: {
  cost: number | null;
  quoting: boolean;
  pending: boolean;
  disabled: boolean;
  label?: string;
}) {
  let text = cost === null ? label : `${label} · ${formatCredit(cost)} Credit`;
  if (quoting && cost === null) text = "Đang tính giá...";
  if (pending) text = "Đang gửi...";
  return (
    <button
      type="submit"
      disabled={disabled || pending || cost === null}
      className="w-full rounded-md bg-neutral-900 px-4 py-3 text-sm font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
    >
      {text}
    </button>
  );
}
