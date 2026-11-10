import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaViewer } from "@/components/library/MediaViewer";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_COLOR, STATUS_LABEL, formatCredit, jobErrorText } from "@/lib/api-client";

export const metadata = { title: "Chi tiết · AuraMotion" };

type Params = {
  aspectRatio?: string;
  aspect?: string;
  imageCount?: number;
  durationSec?: number;
  presetId?: string;
  clips?: unknown[];
  lines?: string[];
};

const KIND_LABEL = { IMAGE: "Ảnh", VIDEO: "Video", ASSEMBLE: "Video ghép" } as const;

function formatDate(d: Date): string {
  return d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id }, include: { model: { select: { name: true } } } });
  if (!job || job.userId !== user.id || job.deletedAt) notFound();

  const p = job.params as Params;
  const preset = p.presetId ? await db.preset.findUnique({ where: { id: p.presetId }, select: { name: true } }) : null;
  const rows: [string, React.ReactNode][] = [
    ["Loại", KIND_LABEL[job.kind]],
    ["Engine", job.model.name],
    ["Tỷ lệ khung", p.aspectRatio ?? p.aspect ?? "—"],
  ];
  if (job.kind === "IMAGE") rows.push(["Số ảnh", p.imageCount ?? 1]);
  if (job.kind === "VIDEO") rows.push(["Thời lượng", `${p.durationSec ?? 5} giây`]);
  if (job.kind === "ASSEMBLE") rows.push(["Số clip", p.clips?.length ?? 0], ["Số câu thoại", p.lines?.length ?? 0]);
  if (preset) rows.push(["Preset", preset.name]);
  rows.push(["Credit", formatCredit(job.cost.toNumber())], ["Tạo lúc", formatDate(job.createdAt)]);
  if (job.finishedAt) rows.push(["Xong lúc", formatDate(job.finishedAt)]);
  if (job.expiresAt) rows.push(["Lưu đến", formatDate(job.expiresAt)]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/library" className="text-sm text-neutral-600 hover:underline">
          ← Thư viện
        </Link>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[job.status]}`}>{STATUS_LABEL[job.status]}</span>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <MediaViewer job={{ id: job.id, kind: job.kind, status: job.status, resultUrls: job.resultUrls, prompt: job.prompt }} />
        <aside className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-medium text-neutral-500">{job.kind === "ASSEMBLE" ? "Lời thoại" : "Prompt"}</h2>
            <p className="text-sm whitespace-pre-wrap text-neutral-900">{job.prompt}</p>
          </div>
          {job.status === "FAILED" && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Tạo thất bại{job.error ? `: ${jobErrorText(job.error)}` : ""}. Credit đã được hoàn.
            </p>
          )}
          {job.inputUrl && (
            <div className="space-y-1">
              <h2 className="text-sm font-medium text-neutral-500">{job.kind === "VIDEO" ? "Ảnh khung đầu" : "Ảnh tham chiếu"}</h2>
              <img src={job.inputUrl} alt="Ảnh đầu vào" className="h-24 w-24 rounded-md border border-neutral-200 object-cover" />
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-neutral-500">{k}</dt>
                <dd className="text-neutral-900">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
