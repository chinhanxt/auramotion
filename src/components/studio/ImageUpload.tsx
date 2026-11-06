"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api-client";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ImageUpload({
  label,
  value,
  onChange,
  onBusyChange,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function setUploading(v: boolean) {
    setBusy(v);
    onBusyChange?.(v);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    if (!TYPES.includes(file.type)) return setError("Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP");
    if (file.size > MAX_BYTES) return setError("Ảnh vượt quá 10 MB");
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "image");
    setUploading(true);
    try {
      const { url } = await api<{ url: string }>("/api/uploads", { method: "POST", body: form });
      onChange(url);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="Ảnh đã tải lên" className="h-20 w-20 rounded-md border border-neutral-200 object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
          >
            Bỏ ảnh
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white px-3 py-4 text-sm text-neutral-600 hover:border-neutral-500">
          {busy ? "Đang tải lên..." : "Chọn ảnh (JPEG, PNG, WebP ≤ 10 MB)"}
          <input
            ref={inputRef}
            type="file"
            accept={TYPES.join(",")}
            className="hidden"
            disabled={busy}
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
