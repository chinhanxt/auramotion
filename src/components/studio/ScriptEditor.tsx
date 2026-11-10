"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { useToast } from "@/components/ui/Toast";
import { postJson } from "@/lib/api-client";
import type { VoiceValue } from "./VoicePicker";

export const MAX_LINES = 20;
export const MAX_LINE_LENGTH = 200;
const PREVIEW_MAX = 120;

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

// Lời thoại: mỗi câu một dòng, nghe thử từng câu bằng giọng đang chọn; AI viết từ mô tả sản phẩm.
export function ScriptEditor({
  value,
  onChange,
  onBusyChange,
  voice,
}: {
  value: string;
  onChange: (v: string) => void;
  onBusyChange?: (busy: boolean) => void;
  voice: VoiceValue;
}) {
  const toast = useToast();
  const [showAi, setShowAi] = useState(false);
  const [idea, setIdea] = useState("");
  const [writing, setWriting] = useState(false);
  const [playing, setPlaying] = useState<number | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);
  const rows = value === "" ? [""] : value.split("\n");
  const count = splitLines(value).length;
  const error = scriptError(value);

  useEffect(() => () => audio.current?.pause(), []);
  useEffect(() => {
    if (focusNext.current !== null) {
      refs.current[focusNext.current]?.focus();
      focusNext.current = null;
    }
  });

  function setRows(next: string[]) {
    onChange(next.join("\n"));
  }

  async function onAiWrite() {
    if (!idea.trim()) return toast.info("Nhập mô tả sản phẩm trước");
    setWriting(true);
    onBusyChange?.(true);
    try {
      const res = await postJson<{ lines?: string[] }>("/api/ai/prompt", { idea: idea.trim(), kind: "script" });
      if (res.lines?.length) {
        onChange(res.lines.slice(0, MAX_LINES).map((l) => l.slice(0, MAX_LINE_LENGTH)).join("\n"));
        setShowAi(false);
        toast.success("AI đã viết lời thoại");
      } else {
        toast.error("AI chưa viết được, vui lòng thử lại");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setWriting(false);
      onBusyChange?.(false);
    }
  }

  async function preview(i: number) {
    const text = rows[i]?.trim();
    if (!text) return;
    if (!voice.preset && !voice.refUrl) return toast.info("Chọn giọng đọc trước");
    if (playing === i) {
      audio.current?.pause();
      return setPlaying(null);
    }
    audio.current?.pause();
    setPlaying(i);
    onBusyChange?.(true);
    try {
      const body = voice.refUrl ? { refUrl: voice.refUrl, text: text.slice(0, PREVIEW_MAX) } : { preset: voice.preset, text: text.slice(0, PREVIEW_MAX) };
      const { url } = await postJson<{ url: string }>("/api/voices/preview", body);
      const a = new Audio(url);
      audio.current = a;
      a.onended = () => setPlaying(null);
      await a.play().catch(() => setPlaying(null));
    } catch (err) {
      toast.error((err as Error).message);
      setPlaying(null);
    } finally {
      onBusyChange?.(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted tabular-nums">
          {count}/{MAX_LINES} câu
        </span>
        <Button size="sm" variant={showAi ? "subtle" : "ghost"} icon="sparkle" onClick={() => setShowAi((v) => !v)}>
          AI viết lời thoại
        </Button>
      </div>

      {showAi && (
        <div className="pop-in space-y-2 rounded-m2 bg-aura1/[.08] p-3 shadow-[inset_0_0_0_1px_rgba(124,92,255,.25)]">
          <Textarea value={idea} maxLength={2000} rows={2} placeholder="Mô tả sản phẩm, ví dụ: nước hoa hổ phách, hương gỗ ấm" onChange={(e) => setIdea(e.target.value)} className="text-sm" />
          <div className="flex justify-end">
            <Button size="sm" variant="primary" loading={writing} onClick={onAiWrite}>
              Viết
            </Button>
          </div>
        </div>
      )}

      <ol className="space-y-1.5">
        {rows.map((line, i) => {
          const long = line.trim().length > MAX_LINE_LENGTH;
          return (
            <li key={i} className={cx("group flex items-center gap-1.5 rounded-m1 bg-white/[.03] pr-1 pl-2.5 shadow-[inset_0_0_0_1px_var(--color-line)] focus-within:shadow-[inset_0_0_0_1px_rgba(212,255,58,.55)]", long && "shadow-[inset_0_0_0_1px_var(--color-danger)]")}>
              <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-dim tabular-nums">{i + 1}</span>
              <input
                ref={(el) => {
                  refs.current[i] = el;
                }}
                value={line}
                placeholder={i === 0 ? "Câu thoại đầu tiên…" : "Câu tiếp theo…"}
                aria-label={`Câu ${i + 1}`}
                onChange={(e) => setRows(rows.map((r, k) => (k === i ? e.target.value.replace(/\n/g, " ") : r)))}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  if (!text.includes("\n")) return;
                  e.preventDefault();
                  const parts = text.split(/\r?\n/).filter((p) => p.trim());
                  setRows([...rows.slice(0, i), ...(line ? [line] : []), ...parts, ...rows.slice(i + 1)].slice(0, MAX_LINES + 5));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (rows.length >= MAX_LINES) return;
                    focusNext.current = i + 1;
                    setRows([...rows.slice(0, i + 1), "", ...rows.slice(i + 1)]);
                  } else if (e.key === "Backspace" && line === "" && rows.length > 1) {
                    e.preventDefault();
                    focusNext.current = Math.max(0, i - 1);
                    setRows(rows.filter((_, k) => k !== i));
                  }
                }}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-dim"
              />
              <IconButton
                icon={playing === i ? "stop" : "play"}
                label={playing === i ? "Dừng" : "Nghe thử câu này"}
                size="sm"
                disabled={!line.trim() || (playing !== null && playing !== i)}
                loading={false}
                onClick={() => preview(i)}
                className={cx(playing === i && "text-accent")}
              />
              {rows.length > 1 && (
                <IconButton icon="close" label="Xóa câu" size="sm" tip={false} onClick={() => setRows(rows.filter((_, k) => k !== i))} className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" />
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          disabled={rows.length >= MAX_LINES}
          onClick={() => {
            focusNext.current = rows.length;
            setRows([...rows, ""]);
          }}
        >
          Thêm câu
        </Button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
      {playing !== null && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Icon name="volume" size={14} /> Đang tạo / phát bản nghe thử…
        </p>
      )}
    </div>
  );
}
