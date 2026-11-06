"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ACTIVE_STATUSES, STATUS_LABEL, api, remakeHref, type JobItem, type JobStatus } from "@/lib/api-client";

const REFRESH_MS = 3000;

function fileName(url: string, index: number): string {
  const ext = url.split(".").pop() ?? "bin";
  return `auramotion-${index + 1}.${ext}`;
}

export function MediaViewer({
  job,
}: {
  job: { id: string; kind: JobItem["kind"]; status: JobStatus; resultUrls: string[]; prompt: string };
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const active = ACTIVE_STATUSES.includes(job.status);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);

  async function onDelete() {
    if (!window.confirm("Xóa kết quả này? Không khôi phục được.")) return;
    setDeleting(true);
    setError("");
    try {
      await api(`/api/jobs/${job.id}`, { method: "DELETE" });
      router.push("/library");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4">
      {job.resultUrls.length > 0 ? (
        <div className={`grid gap-3 ${job.resultUrls.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {job.resultUrls.map((url, i) => (
            <figure key={url} className="space-y-2">
              {job.kind === "IMAGE" ? (
                <img src={url} alt={job.prompt} className="max-h-[70vh] w-full rounded-lg bg-neutral-100 object-contain" />
              ) : (
                <video src={url} controls playsInline className="max-h-[70vh] w-full rounded-lg bg-black" />
              )}
              <a
                href={url}
                download={fileName(url, i)}
                className="inline-block rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                Tải xuống{job.resultUrls.length > 1 ? ` #${i + 1}` : ""}
              </a>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-neutral-100 text-sm text-neutral-500">
          {active ? <span className="animate-pulse">{STATUS_LABEL[job.status]}...</span> : "Không có kết quả"}
        </div>
      )}

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Link href={remakeHref(job)} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800">
          Tạo lại
        </Link>
        {!active && (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "Đang xóa..." : "Xóa"}
          </button>
        )}
      </div>
    </div>
  );
}
