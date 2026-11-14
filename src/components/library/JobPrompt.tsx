"use client";

import { useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ProviderLogo } from "@/components/ui/VendorLogo";
import type { WriteParams, WrittenInfo } from "@/lib/api-client";
import { providerLabel } from "@/lib/providers";

type View = "idea" | "prompt";

// "✦ Skill · Google · 3.3s" — ai đã viết prompt cho job.
export function WrittenLine({ written, ms, className }: { written: WrittenInfo; ms?: boolean; className?: string }) {
  return (
    <span className={cx("inline-flex min-w-0 items-center gap-1 text-[11px] font-medium", className)}>
      <Icon name="sparkle" size={11} className="shrink-0 text-accent" />
      <span className="truncate">{written.skillName}</span>
      <span className="inline-flex min-w-0 shrink items-center gap-1 overflow-hidden">
        <span className="opacity-60">·</span>
        <ProviderLogo provider={written.provider} model={written.model} size={11} plain />
        <span className="truncate opacity-60">{providerLabel(written.provider)}</span>
      </span>
      {ms && written.ms > 0 && <span className="shrink-0 tabular-nums opacity-60">· {(written.ms / 1000).toFixed(1)}s</span>}
    </span>
  );
}

// Dòng "AI đang viết prompt…" (kèm tên skill nếu biết) cho skeleton của ô / trình xem.
export function WritingLabel({ skillName, className }: { skillName?: string; className?: string }) {
  return (
    <span className={cx("flex min-w-0 items-center gap-2 text-[12px] font-medium whitespace-nowrap text-fg/85", className)}>
      <Icon name="sparkle" size={13} className="shrink-0 animate-pulse text-accent" />
      <span className="truncate">AI đang viết prompt…</span>
      {skillName && <span className="min-w-0 truncate rounded-full bg-aura1/20 px-2 py-0.5 text-[11px] font-semibold text-[#c9bdff]">{skillName}</span>}
    </span>
  );
}

// Vạch chữ "đang chảy" trong lúc AI viết.
export function WritingLines({ className }: { className?: string }) {
  return (
    <span className={cx("write-lines block space-y-1.5", className)} aria-hidden="true">
      <i style={{ width: "94%" }} />
      <i style={{ width: "78%" }} />
      <i style={{ width: "52%" }} />
    </span>
  );
}

// Ý tưởng ↔ prompt đã viết. `panel`: khối chữ đầy đủ (lightbox / chi tiết); `tile`: chú thích 2 dòng trên ô.
export function JobPrompt({
  prompt,
  params,
  variant = "panel",
  label = "Prompt",
  writing,
  className,
}: {
  prompt: string;
  params?: Record<string, unknown> | null;
  variant?: "panel" | "tile";
  label?: string;
  writing?: boolean;
  className?: string;
}) {
  const p = (params ?? {}) as WriteParams;
  const written = p.written;
  const idea = p.idea?.trim();
  const canToggle = Boolean(written && idea && idea !== prompt.trim());
  const [view, setView] = useState<View>(variant === "tile" ? "idea" : "prompt");
  const showIdea = canToggle && view === "idea";
  const text = showIdea ? idea : prompt;
  const flip = () => setView((v) => (v === "idea" ? "prompt" : "idea"));

  if (variant === "tile") {
    return (
      <div className={cx("space-y-1", className)}>
        {written && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (canToggle) flip();
            }}
            data-tip={canToggle ? (showIdea ? "Xem prompt AI viết" : "Xem ý tưởng gốc") : undefined}
            className={cx("pointer-events-none flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full group-hover/tile:pointer-events-auto bg-black/45 px-2 py-0.5 text-white/85 backdrop-blur-md", canToggle && "press hover:bg-black/70")}
          >
            <WrittenLine written={written} />
            {canToggle && <span className="hidden shrink-0 text-[10px] font-semibold text-white/55 @[210px]/tile:inline">{showIdea ? "Ý tưởng" : "Prompt"}</span>}
          </button>
        )}
        <p className="line-clamp-2 text-[12px] leading-snug text-white/90">{text}</p>
      </div>
    );
  }

  return (
    <div className={cx("space-y-2", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="t-label">{showIdea || (writing && !written) ? "Ý tưởng" : label}</h2>
        {canToggle && (
          <div role="group" aria-label="Xem" className="inline-flex rounded-full bg-white/[.05] p-0.5 text-[11px] font-medium">
            {(["idea", "prompt"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={cx("press rounded-full px-2.5 py-0.5", view === v ? "bg-white/[.12] text-fg" : "text-muted hover:text-fg")}
              >
                {v === "idea" ? "Ý tưởng" : "Prompt"}
              </button>
            ))}
          </div>
        )}
      </div>
      {written ? (
        <WrittenLine written={written} ms className="max-w-full text-muted" />
      ) : (
        writing && <WritingLabel skillName={p.skillName} className="text-muted" />
      )}
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-fg/90">{text}</p>
    </div>
  );
}
