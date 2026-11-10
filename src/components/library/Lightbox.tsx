"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/Bits";
import { buttonClass, IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, useFocusTrap } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { api, formatCredit, isVideoUrl, jobAspect, remakeHref, type JobItem } from "@/lib/api-client";
import { downloadName } from "./JobTile";

export type LightboxEntry = { job: JobItem; index: number };

const KIND_LABEL = { IMAGE: "Ảnh", VIDEO: "Video", ASSEMBLE: "Ghép" } as const;

// Trình xem toàn màn hình: ←/→ chuyển, Esc đóng; mở ra phóng từ đúng vị trí ô đã bấm.
export default function Lightbox({
  entries,
  start,
  origin,
  onClose,
  onDeleted,
}: {
  entries: LightboxEntry[];
  start: number;
  origin?: DOMRect | null;
  onClose: () => void;
  onDeleted?: (id: string) => void;
}) {
  const toast = useToast();
  const [i, setI] = useState(start);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [closing, setClosing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useFocusTrap(root, true);

  const entry = entries[Math.min(i, entries.length - 1)];
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    if (entries.length === 0) onClose();
  }, [entries.length, onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (confirm) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setI((v) => Math.min(entries.length - 1, v + 1));
      else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entries.length, close, confirm]);

  // Phóng từ ô gốc → giữa màn hình (chỉ transform/opacity).
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el || !origin || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = el.getBoundingClientRect();
    if (to.width === 0) return;
    const s = Math.min(origin.width / to.width, origin.height / to.height);
    const dx = origin.left + origin.width / 2 - (to.left + to.width / 2);
    const dy = origin.top + origin.height / 2 - (to.top + to.height / 2);
    el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0.4, borderRadius: "14px" },
        { transform: "none", opacity: 1, borderRadius: "14px" },
      ],
      { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    // chỉ khi mở
  }, []);

  if (!entry) return null;
  const { job, index } = entry;
  const url = job.resultUrls[index];
  const video = job.kind !== "IMAGE" || (url ? isVideoUrl(url) : false);
  const params = (job.params ?? {}) as { durationSec?: number };

  async function onDelete() {
    setDeleting(true);
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      toast.success("Đã xóa");
      setConfirm(false);
      onDeleted?.(job.id);
      setI((v) => Math.max(0, Math.min(v, entries.length - 2)));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div ref={root} role="dialog" aria-modal="true" aria-label="Xem kết quả" className={cx("am-layer fixed inset-0 z-[85] flex flex-col lg:flex-row", closing ? "lightbox-out" : "")}>
      <div className="overlay-backdrop absolute inset-0 bg-[#050506]/95 backdrop-blur-xl" onClick={close} />

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 pt-16 sm:p-6 sm:pt-16 lg:p-10" onClick={close}>
        <div ref={stage} className="relative flex h-full w-full items-center justify-center" onClick={(e) => e.stopPropagation()}>
          {url &&
            (video ? (
              <video key={url} src={url} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-m2 bg-black shadow-2xl" style={{ aspectRatio: jobAspect(job).replace(":", " / ") }} />
            ) : (
              <img key={url} src={url} alt={job.prompt} className="max-h-full max-w-full rounded-m2 object-contain shadow-2xl" />
            ))}
        </div>
        {entries.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Trước"
              disabled={i === 0}
              onClick={(e) => (e.stopPropagation(), setI((v) => Math.max(0, v - 1)))}
              className="press glass absolute top-1/2 left-3 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full hairline hover:bg-white/10 disabled:opacity-0 sm:flex"
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              aria-label="Sau"
              disabled={i === entries.length - 1}
              onClick={(e) => (e.stopPropagation(), setI((v) => Math.min(entries.length - 1, v + 1)))}
              className="press glass absolute top-1/2 right-3 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full hairline hover:bg-white/10 disabled:opacity-0 sm:flex"
            >
              <Icon name="chevronRight" />
            </button>
          </>
        )}
      </div>

      <div className="absolute top-3 right-3 left-3 z-10 flex items-center justify-between gap-2">
        <span className="glass rounded-full px-3 py-1.5 text-xs font-medium text-fg/80 tabular-nums hairline">
          {i + 1} / {entries.length}
        </span>
        <IconButton icon="close" label="Đóng (Esc)" variant="glass" onClick={close} tip={false} data-autofocus />
      </div>

      <aside className="relative flex max-h-[42dvh] shrink-0 flex-col gap-4 overflow-y-auto border-t border-line bg-s1/90 p-4 pb-[calc(16px+var(--safe-b))] backdrop-blur-xl lg:max-h-none lg:w-[360px] lg:border-t-0 lg:border-l lg:p-6 lg:pt-20">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge>{KIND_LABEL[job.kind]}</Badge>
          <Badge>{jobAspect(job)}</Badge>
          {job.kind === "VIDEO" && params.durationSec && <Badge>{params.durationSec}s</Badge>}
          <Badge tone="neutral">{formatCredit(job.cost)} Credit</Badge>
        </div>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-fg/90">{job.prompt}</p>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(job.prompt).then(() => toast.success("Đã chép prompt"), () => {})}
          className="press -mt-2 inline-flex w-fit items-center gap-1.5 text-xs font-medium text-muted hover:text-fg"
        >
          <Icon name="copy" size={14} /> Chép prompt
        </button>
        <div className="mt-auto grid grid-cols-2 gap-2">
          {url && (
            <a href={url} download={downloadName(url, index)} className={buttonClass({ variant: "primary", block: true })}>
              <Icon name="download" size={18} /> Tải
            </a>
          )}
          <Link href={remakeHref(job)} className={buttonClass({ variant: "subtle", block: true })}>
            <Icon name="refresh" size={18} /> Tạo lại
          </Link>
          {job.kind === "IMAGE" && url && (
            <Link href={`/studio/video?frame=${encodeURIComponent(url)}&prompt=${encodeURIComponent(job.prompt)}`} className={cx(buttonClass({ variant: "subtle", block: true }), "col-span-2")}>
              <Icon name="frame" size={18} /> Dùng làm khung đầu video
            </Link>
          )}
          <Link href={`/library/${job.id}`} className={buttonClass({ variant: "ghost", block: true })}>
            <Icon name="info" size={18} /> Chi tiết
          </Link>
          <button type="button" onClick={() => setConfirm(true)} className={buttonClass({ variant: "danger", block: true })}>
            <Icon name="trash" size={18} /> Xóa
          </button>
        </div>
      </aside>

      <ConfirmDialog
        open={confirm}
        title="Xóa kết quả này?"
        body="Không khôi phục được."
        confirmLabel="Xóa"
        danger
        busy={deleting}
        onConfirm={onDelete}
        onClose={() => setConfirm(false)}
      />
    </div>,
    document.body,
  );
}
