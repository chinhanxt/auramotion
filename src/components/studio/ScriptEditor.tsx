"use client";

import { useState } from "react";
import { ApiError, postJson } from "@/lib/api-client";

export const MAX_LINES = 20;
export const MAX_LINE_LENGTH = 200;

export function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function scriptError(text: string): string | null {
  const lines = splitLines(text);
  if (lines.length > MAX_LINES) return `Tối đa ${MAX_LINES} câu`;
  const long = lines.findIndex((l) => l.length > MAX_LINE_LENGTH);
  if (long >= 0) return `Câu ${long + 1} dài quá ${MAX_LINE_LENGTH} ký tự`;
  return null;
}

// Lời thoại: mỗi dòng một câu. Nút "AI viết lời thoại" viết từ mô tả sản phẩm.
export function ScriptEditor({
  value,
  onChange,
  onBusyChange,
}: {
  value: string;
  onChange: (v: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [showAi, setShowAi] = useState(false);
  const [idea, setIdea] = useState("");
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState("");
  const count = splitLines(value).length;
  const error = scriptError(value);

  async function onAiWrite() {
    if (!idea.trim()) return setAiError("Nhập mô tả sản phẩm trước");
    setWriting(true);
    onBusyChange?.(true);
    setAiError("");
    try {
      const res = await postJson<{ lines?: string[] }>("/api/ai/prompt", { idea: idea.trim(), kind: "script" });
      if (res.lines?.length) {
        onChange(res.lines.slice(0, MAX_LINES).map((l) => l.slice(0, MAX_LINE_LENGTH)).join("\n"));
        setShowAi(false);
      } else {
        setAiError("AI chưa viết được, vui lòng thử lại");
      }
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : (err as Error).message);
    } finally {
      setWriting(false);
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="script" className="text-sm font-medium text-neutral-700">
          Lời thoại
        </label>
        <button
          type="button"
          onClick={() => setShowAi((v) => !v)}
          className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100"
        >
          AI viết lời thoại
        </button>
      </div>

      {showAi && (
        <div className="space-y-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
          <textarea
            value={idea}
            maxLength={2000}
            rows={2}
            placeholder="Mô tả sản phẩm, ví dụ: nước hoa hổ phách, hương gỗ ấm, dành cho buổi tối"
            onChange={(e) => setIdea(e.target.value)}
            className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
          />
          <div className="flex items-center justify-between gap-2">
            {aiError ? <p className="text-xs text-red-600">{aiError}</p> : <span />}
            <button
              type="button"
              onClick={onAiWrite}
              disabled={writing}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {writing ? "AI đang viết..." : "Viết"}
            </button>
          </div>
        </div>
      )}

      <textarea
        id="script"
        value={value}
        rows={5}
        placeholder={"Mỗi dòng một câu, ví dụ:\nHương hổ phách ấm áp cho buổi tối.\nĐặt mua ngay hôm nay."}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
      />
      <div className="flex justify-between text-xs">
        <span className="text-red-600">{error}</span>
        <span className="text-neutral-400">
          {count}/{MAX_LINES} câu
        </span>
      </div>
    </div>
  );
}
