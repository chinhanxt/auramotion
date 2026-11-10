"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useJobEvents, useRealtime } from "@/components/realtime/Events";
import { AuraBar } from "@/components/ui/Bits";
import { buttonClass } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { ACTIVE_STATUSES, STATUS_LABEL, api, isVideoUrl, ratioCss, remakeHref, type JobItem, type JobStatus } from "@/lib/api-client";
import { downloadName } from "./JobTile";

const REFRESH_MS = 3000;

type ViewerJob = { id: string; kind: JobItem["kind"]; status: JobStatus; resultUrls: string[]; prompt: string; aspect: string; progress?: number };

export function MediaViewer({ job }: { job: ViewerJob }) {
  const router = useRouter();
  const toast = useToast();
  const { live } = useRealtime();
  const [i, setI] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [progress, setProgress] = useState(job.progress);
  const active = ACTIVE_STATUSES.includes(job.status);

  useJobEvents((e) => {
    if (e.id !== job.id) return;
    setProgress(e.progress);
    if (!ACTIVE_STATUSES.includes(e.status)) router.refresh();
  });

  useEffect(() => {
    if (!active || live) return;
    const t = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [active, live, router]);

  async function onDelete() {
    setDeleting(true);
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      toast.success("Đã xóa");
      router.push("/library");
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  }

  const url = job.resultUrls[i];
  const video = url ? job.kind !== "IMAGE" || isVideoUrl(url) : false;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="relative flex min-h-[40vh] flex-1 items-center justify-center overflow-hidden rounded-m4 bg-[#050506] p-2 hairline sm:p-4 lg:min-h-[calc(100dvh-140px)]">
        {url ? (
          video ? (
            <video key={url} src={url} controls playsInline loop className="blur-in max-h-[78dvh] max-w-full rounded-m2 bg-black" />
          ) : (
            <img key={url} src={url} alt={job.prompt} className="blur-in max-h-[78dvh] max-w-full rounded-m2 object-contain" />
          )
        ) : active ? (
          <div className="skel skel-aura w-full max-w-md rounded-m3" style={{ aspectRatio: ratioCss(job.aspect) }}>
            <div className="absolute inset-x-5 bottom-5 space-y-2">
              <p className="text-sm font-medium">{STATUS_LABEL[job.status]}…</p>
              <AuraBar value={progress} />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">Không có kết quả</p>
        )}
      </div>

      {job.resultUrls.length > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {job.resultUrls.map((u, k) => (
            <button
              key={u}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Kết quả ${k + 1}`}
              className={cx("press h-16 w-16 shrink-0 overflow-hidden rounded-m1 hairline", k === i ? "ring-2 ring-accent" : "opacity-60 hover:opacity-100")}
            >
              {job.kind === "IMAGE" ? <img src={u} alt="" className="h-full w-full object-cover" /> : <video src={`${u}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {url && (
          <a href={url} download={downloadName(url, i)} className={buttonClass({ variant: "primary" })}>
            <Icon name="download" size={18} /> Tải{job.resultUrls.length > 1 ? ` #${i + 1}` : ""}
          </a>
        )}
        <Link href={remakeHref(job)} className={buttonClass({ variant: "subtle" })}>
          <Icon name="refresh" size={18} /> Tạo lại
        </Link>
        {job.kind === "IMAGE" && url && (
          <Link href={`/studio/video?frame=${encodeURIComponent(url)}&prompt=${encodeURIComponent(job.prompt)}`} className={buttonClass({ variant: "subtle" })}>
            <Icon name="frame" size={18} /> Làm khung đầu video
          </Link>
        )}
        {!active && (
          <button type="button" onClick={() => setConfirm(true)} className={cx(buttonClass({ variant: "danger" }), "sm:ml-auto")}>
            <Icon name="trash" size={18} /> Xóa
          </button>
        )}
      </div>

      <ConfirmDialog open={confirm} title="Xóa kết quả này?" body="Không khôi phục được." confirmLabel="Xóa" danger busy={deleting} onConfirm={onDelete} onClose={() => setConfirm(false)} />
    </div>
  );
}
