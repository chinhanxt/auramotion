"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { WrittenLine } from "@/components/library/JobPrompt";
import { downloadName } from "@/components/library/JobTile";
import { AuraBar } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ACTIVE_STATUSES, STATUS_LABEL, isVideoUrl, isWriting, jobAspect, jobErrorText, ratioCss, remakeHref, writeParams, type JobItem } from "@/lib/api-client";
import { thumbUrl } from "@/lib/media-url";

// Gõ chữ dần (như đang stream): chạy 1 lần cho mỗi chuỗi mới, ~70 ký tự/giây.
function useTypewriter(text: string, run: boolean) {
  const [n, setN] = useState(run ? 0 : text.length);
  const last = useRef(text);
  useEffect(() => {
    if (!run) {
      setN(text.length);
      last.current = text;
      return;
    }
    if (last.current !== text) {
      last.current = text;
      setN(0);
    }
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      t0 ||= t;
      const k = Math.min(text.length, Math.floor(((t - t0) / 1000) * 70));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, run]);
  return { shown: text.slice(0, n), typing: n < text.length };
}

function useElapsed(since: string, on: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t0 = new Date(since).getTime();
    const tick = () => setS(Math.max(0, Math.round((Date.now() - t0) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [since, on]);
  return s;
}

// Màn xem giữa trang: đang chạy → khung "đang hiện hình" (aura + chữ prompt chảy ra), xong → ảnh/video hiện dần từ mờ sang nét.
export function Stage({ job, onOpen, onClose }: { job: JobItem; onOpen: (job: JobItem, index: number, el: HTMLElement) => void; onClose: () => void }) {
  const active = ACTIVE_STATUSES.includes(job.status);
  const writing = isWriting(job);
  const done = job.status === "SUCCEEDED" && job.resultUrls.length > 0;
  const failed = !active && !done;
  const wp = writeParams(job);
  const [idx, setIdx] = useState(0);
  const url = job.resultUrls[idx];
  const video = Boolean(url) && (job.kind !== "IMAGE" || isVideoUrl(url));
  const elapsed = useElapsed(job.createdAt, active);
  const pct = typeof job.progress === "number" ? job.progress : null;
  const text = writing ? (wp.idea ?? job.prompt) : job.prompt;
  const { shown, typing } = useTypewriter(text, !writing);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);
  const ratio = ratioCss(jobAspect(job));
  const frame = useRef<HTMLDivElement>(null);

  const phase = writing ? "AI đang viết prompt…" : active ? (job.kind === "VIDEO" ? "Đang dựng video" : "Đang vẽ ảnh") : done ? "Hoàn tất" : STATUS_LABEL[job.status];

  return (
    <section className="stage reveal mx-auto mb-6 flex w-full max-w-[1040px] flex-col items-stretch gap-4 rounded-m4 bg-s1 p-3 hairline sm:p-4 lg:flex-row lg:items-center lg:gap-6" aria-live="polite">
      <div className="flex min-w-0 flex-1 justify-center">
        <div
          ref={frame}
          role={done ? "button" : undefined}
          tabIndex={done ? 0 : undefined}
          onClick={(e) => done && onOpen(job, idx, e.currentTarget)}
          onKeyDown={(e) => done && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen(job, idx, e.currentTarget))}
          className={cx("relative overflow-hidden rounded-m3 bg-s2 hairline", done && "cursor-zoom-in")}
          style={{ aspectRatio: ratio, height: "min(58vh, 540px)", maxWidth: "100%" }}
        >
          {done && url ? (
            <>
              {/* ảnh nhỏ hiện ngay (mờ), ảnh nét chồng lên khi tải xong */}
              <span className={cx("stage-aura absolute inset-0 transition-opacity duration-700", loaded && "opacity-0")} aria-hidden="true" />
              {video ? (
                <video
                  key={url}
                  src={url}
                  autoPlay
                  muted
                  loop
                  playsInline
                  onLoadedData={() => setLoaded(true)}
                  className={cx("stage-reveal absolute inset-0 h-full w-full object-cover", loaded && "is-in")}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={thumbUrl(url, 960)}
                  alt={job.prompt}
                  onLoad={() => setLoaded(true)}
                  className={cx("stage-reveal absolute inset-0 h-full w-full object-cover", loaded && "is-in")}
                />
              )}
            </>
          ) : active ? (
            <div className="skel skel-aura absolute inset-0">
              <span className="stage-orb stage-orb-a" aria-hidden="true" />
              <span className="stage-orb stage-orb-b" aria-hidden="true" />
              <span className="stage-scan" aria-hidden="true" />
              <div className="absolute inset-x-4 bottom-4 space-y-2.5">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-fg/90">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inset-0 rounded-full bg-accent opacity-60 blur-[3px]" />
                    <span className="relative h-2 w-2 rounded-full bg-accent" />
                  </span>
                  {phase}
                  <span className="ml-auto tabular-nums text-muted">{pct !== null && pct > 0 ? `${Math.round(pct)}% · ` : ""}{elapsed}s</span>
                </div>
                <AuraBar value={pct} />
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
              <Icon name="alert" size={24} className="text-danger" />
              <p className="text-[14px] font-semibold">{STATUS_LABEL[job.status]}</p>
              {job.error && <p className="line-clamp-3 text-xs text-muted">{jobErrorText(job.error)}</p>}
            </div>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-[400px]">
        <div className="flex items-center gap-2">
          <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", done ? "bg-ok/15 text-ok" : failed ? "bg-danger/15 text-danger" : "bg-aura1/20 text-[#c9bdff]")}>
            <Icon name={done ? "check" : failed ? "alert" : "sparkle"} size={13} className={cx(active && "animate-pulse")} />
            {phase}
          </span>
          {wp.written && <WrittenLine written={wp.written} ms className="min-w-0 text-muted" />}
          <button type="button" onClick={onClose} aria-label="Đóng" className="press ml-auto flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-white/[.08] hover:text-fg">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="min-h-[96px]">
          <p className="t-label mb-1.5">{writing ? "Ý tưởng của bạn" : "Prompt AI viết"}</p>
          <p className="max-h-[34vh] overflow-y-auto text-[14.5px] leading-relaxed whitespace-pre-wrap text-fg/90">
            {shown}
            {(typing || writing) && <span className="stage-caret" aria-hidden="true" />}
          </p>
          {writing && (
            <span className="write-lines mt-3 block space-y-1.5" aria-hidden="true">
              <i style={{ width: "92%" }} />
              <i style={{ width: "74%" }} />
              <i style={{ width: "48%" }} />
            </span>
          )}
        </div>

        {done && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => frame.current && onOpen(job, idx, frame.current)} className="press inline-flex h-10 items-center gap-2 rounded-full bg-fg px-4 text-[13px] font-semibold text-bg">
              <Icon name="eye" size={15} /> Xem lớn
            </button>
            <a href={url} download={downloadName(url, idx)} className="press inline-flex h-10 items-center gap-2 rounded-full bg-white/[.08] px-4 text-[13px] font-medium hover:bg-white/[.14]">
              <Icon name="download" size={15} /> Tải
            </a>
            {job.kind === "IMAGE" && !video && (
              <Link href={`/studio/video?frame=${encodeURIComponent(url)}&prompt=${encodeURIComponent(job.prompt)}`} className="press inline-flex h-10 items-center gap-2 rounded-full bg-white/[.08] px-4 text-[13px] font-medium hover:bg-white/[.14]">
                <Icon name="frame" size={15} /> Làm video
              </Link>
            )}
            <Link href={remakeHref(job)} className="press inline-flex h-10 items-center gap-2 rounded-full bg-white/[.08] px-4 text-[13px] font-medium hover:bg-white/[.14]">
              <Icon name="refresh" size={15} /> Tạo lại
            </Link>
          </div>
        )}
        {done && job.resultUrls.length > 1 && (
          <div className="flex gap-2">
            {job.resultUrls.map((u, i) => (
              <button key={u} type="button" onClick={() => setIdx(i)} aria-label={`Ảnh ${i + 1}`} className={cx("press h-14 w-14 overflow-hidden rounded-m1 hairline", i === idx ? "ring-2 ring-accent" : "opacity-70 hover:opacity-100")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {isVideoUrl(u) ? <span className="block h-full w-full bg-s3" /> : <img src={thumbUrl(u, 160)} alt="" className="h-full w-full object-cover" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
