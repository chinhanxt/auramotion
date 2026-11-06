import Link from "next/link";
import { ACTIVE_STATUSES, STATUS_COLOR, STATUS_LABEL, formatCredit, type JobItem } from "@/lib/api-client";

function Preview({ job }: { job: JobItem }) {
  const url = job.resultUrls[0];
  if (job.status === "SUCCEEDED" && url) {
    return job.kind === "IMAGE" ? (
      <img src={url} alt={job.prompt} loading="lazy" className="h-full w-full object-cover" />
    ) : (
      <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
    );
  }
  const active = ACTIVE_STATUSES.includes(job.status);
  return (
    <div className="flex h-full w-full items-center justify-center text-sm text-neutral-500">
      {active ? <span className="animate-pulse">{STATUS_LABEL[job.status]}...</span> : STATUS_LABEL[job.status]}
    </div>
  );
}

export function JobCard({ job }: { job: JobItem }) {
  return (
    <Link
      href={`/library/${job.id}`}
      className="group block overflow-hidden rounded-lg border border-neutral-200 bg-white hover:border-neutral-400"
    >
      <div className="relative aspect-square bg-neutral-100">
        <Preview job={job} />
        <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[job.status]}`}>
          {STATUS_LABEL[job.status]}
        </span>
        {job.resultUrls.length > 1 && (
          <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            {job.resultUrls.length} {job.kind === "IMAGE" ? "ảnh" : "file"}
          </span>
        )}
      </div>
      <div className="space-y-1 p-2">
        <p className="line-clamp-2 text-sm text-neutral-800">{job.prompt}</p>
        <p className="text-xs text-neutral-500">
          {formatCredit(job.cost)} Credit · {new Date(job.createdAt).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" })}
        </p>
      </div>
    </Link>
  );
}
