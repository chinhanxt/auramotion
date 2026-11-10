"use client";

import Link from "next/link";
import { memo, useState } from "react";
import { AuraBar } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { FadeImage, SmartVideo } from "@/components/ui/Media";
import { ACTIVE_STATUSES, STATUS_LABEL, isVideoUrl, jobAspect, jobErrorText, ratioCss, remakeHref, type JobItem } from "@/lib/api-client";

export type TileAction = "download" | "remake" | "frame" | "ref" | "delete" | "details";

export function downloadName(url: string, index: number) {
  const ext = url.split(/[?#]/)[0].split(".").pop() ?? "bin";
  return `auramotion-${index + 1}.${ext}`;
}

function ActionBtn({ icon, label, onClick, href, download }: { icon: IconName; label: string; onClick?: () => void; href?: string; download?: string }) {
  const cls =
    "press flex h-8 w-8 items-center justify-center rounded-[9px] bg-black/55 text-white backdrop-blur-md hover:bg-black/80 shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]";
  if (href) {
    return download ? (
      <a href={href} download={download} aria-label={label} data-tip={label} data-tip-side="bottom" className={cls} onClick={(e) => e.stopPropagation()}>
        <Icon name={icon} size={16} />
      </a>
    ) : (
      <Link href={href} aria-label={label} data-tip={label} data-tip-side="bottom" className={cls} onClick={(e) => e.stopPropagation()}>
        <Icon name={icon} size={16} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-side="bottom"
      className={cls}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

// Ô kết quả: skeleton + tiến độ khi đang chạy, ảnh/video hiện dần khi xong, lỗi có nút tạo lại.
export const JobTile = memo(function JobTile({
  job,
  index = 0,
  order = 0,
  actions = ["download", "remake", "delete"],
  onOpen,
  onDelete,
  onUseRef,
  fixedRatio,
  showCount,
}: {
  job: JobItem;
  index?: number;
  order?: number;
  actions?: TileAction[];
  onOpen?: (job: JobItem, index: number, el: HTMLElement) => void;
  onDelete?: (job: JobItem) => void;
  onUseRef?: (url: string) => void;
  fixedRatio?: string;
  showCount?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const ratio = ratioCss(fixedRatio ?? jobAspect(job));
  const active = ACTIVE_STATUSES.includes(job.status);
  const url = job.resultUrls[index];
  const done = job.status === "SUCCEEDED" && url;
  const video = done && (job.kind !== "IMAGE" || isVideoUrl(url));
  const pct = typeof job.progress === "number" ? job.progress : null;

  return (
    <div
      className="reveal group/tile relative"
      style={{ "--i": order } as React.CSSProperties}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={() => setHover(false)}
    >
      <div
        role={done ? "button" : undefined}
        tabIndex={done ? 0 : undefined}
        aria-label={done ? `Xem: ${job.prompt}` : undefined}
        onClick={(e) => done && onOpen?.(job, index, e.currentTarget)}
        onKeyDown={(e) => done && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen?.(job, index, e.currentTarget))}
        className={cx(
          "lift relative block w-full overflow-hidden rounded-m2 bg-s2 hairline",
          done && "cursor-zoom-in",
        )}
        style={{ aspectRatio: ratio }}
      >
        {done ? (
          video ? (
            <SmartVideo src={url} hovering={hover} className="absolute inset-0" />
          ) : (
            <FadeImage src={url} alt={job.prompt} className="absolute inset-0" imgClassName="transition-transform duration-[700ms] ease-[var(--ease-out)] group-hover/tile:scale-[1.025]" />
          )
        ) : active ? (
          <div className="skel skel-aura @container absolute inset-0 flex flex-col justify-end p-2.5 sm:p-3.5">
            <div className="relative space-y-2.5">
              <div className="flex items-center gap-2 text-[12px] font-medium whitespace-nowrap text-fg/85">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inset-0 rounded-full bg-accent opacity-60 blur-[3px]" />
                  <span className="relative h-2 w-2 rounded-full bg-accent" />
                </span>
                <span className="truncate">{STATUS_LABEL[job.status]}</span>
                {pct !== null && pct > 0 && <span className="ml-auto hidden tabular-nums text-muted @[150px]:inline">{Math.round(pct)}%</span>}
              </div>
              <AuraBar value={pct} />
              <p className="hidden text-[12px] leading-snug text-muted @[150px]:line-clamp-2">{job.prompt}</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(circle_at_50%_40%,rgba(255,92,108,.08),transparent_60%)] p-4 text-center">
            <Icon name={job.status === "FAILED" ? "alert" : "close"} size={22} className={job.status === "FAILED" ? "text-danger" : "text-muted"} />
            <p className="text-[13px] font-semibold">{STATUS_LABEL[job.status]}</p>
            {job.error && <p className="line-clamp-2 text-xs text-muted">{jobErrorText(job.error)}</p>}
            <Link href={remakeHref(job)} className="press mt-1 rounded-full bg-white/[.08] px-3 py-1 text-xs font-medium hover:bg-white/[.14]">
              Tạo lại
            </Link>
          </div>
        )}

        {done && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/75 via-black/20 to-transparent opacity-0 transition-opacity duration-[260ms] group-hover/tile:opacity-100 group-focus-within/tile:opacity-100" />
            <p className="pointer-events-none absolute inset-x-3 bottom-2.5 line-clamp-2 translate-y-1 text-[12px] leading-snug text-white/90 opacity-0 transition-[opacity,transform] duration-[260ms] group-hover/tile:translate-y-0 group-hover/tile:opacity-100">
              {job.prompt}
            </p>
          </>
        )}
        {video && (
          <span className="pointer-events-none absolute top-2.5 left-2.5 flex h-6 items-center gap-1 rounded-full bg-black/50 px-2 text-[11px] font-medium text-white/90 backdrop-blur-md transition-opacity group-hover/tile:opacity-0">
            <Icon name="play" size={11} />
            {job.kind === "ASSEMBLE" ? "Ghép" : "Video"}
          </span>
        )}
        {showCount && job.resultUrls.length > 1 && (
          <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-md group-hover/tile:opacity-0">
            {job.resultUrls.length} ảnh
          </span>
        )}
      </div>

      {(done || (!active && actions.includes("delete"))) && (
        <div
          className={cx(
            "absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity duration-[160ms] group-hover/tile:opacity-100 group-focus-within/tile:opacity-100",
            done ? "[@media(hover:none)]:hidden" : "[@media(hover:none)]:opacity-100",
          )}
        >
          {done && actions.includes("download") && <ActionBtn icon="download" label="Tải xuống" href={url} download={downloadName(url, index)} />}
          {done && actions.includes("ref") && onUseRef && job.kind === "IMAGE" && <ActionBtn icon="image" label="Dùng làm tham chiếu" onClick={() => onUseRef(url)} />}
          {done && actions.includes("frame") && job.kind === "IMAGE" && (
            <ActionBtn icon="frame" label="Dùng làm khung đầu" href={`/studio/video?frame=${encodeURIComponent(url)}&prompt=${encodeURIComponent(job.prompt)}`} />
          )}
          {actions.includes("remake") && <ActionBtn icon="refresh" label="Tạo lại" href={remakeHref(job)} />}
          {actions.includes("details") && <ActionBtn icon="info" label="Chi tiết" href={`/library/${job.id}`} />}
          {actions.includes("delete") && onDelete && <ActionBtn icon="trash" label="Xóa" onClick={() => onDelete(job)} />}
        </div>
      )}
    </div>
  );
});
