import Link from "next/link";
import { notFound } from "next/navigation";
import { MediaViewer } from "@/components/library/MediaViewer";
import { Badge, Notice } from "@/components/ui/Bits";
import { Icon } from "@/components/ui/Icon";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { STATUS_LABEL, STATUS_TONE, formatCredit, jobErrorText } from "@/lib/api-client";

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
  return d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const job = await db.job.findUnique({ where: { id }, include: { model: { select: { name: true } } } });
  if (!job || job.userId !== user.id || job.deletedAt) notFound();

  const p = job.params as Params;
  const preset = p.presetId ? await db.preset.findUnique({ where: { id: p.presetId }, select: { name: true } }) : null;
  const aspect = p.aspectRatio ?? p.aspect ?? (job.kind === "IMAGE" ? "1:1" : "9:16");
  const rows: [string, React.ReactNode][] = [
    ["Loại", KIND_LABEL[job.kind]],
    ["Engine", job.model.name],
    ["Tỷ lệ khung", aspect],
  ];
  if (job.kind === "IMAGE") rows.push(["Số ảnh", p.imageCount ?? 1]);
  if (job.kind === "VIDEO") rows.push(["Thời lượng", `${p.durationSec ?? 5} giây`]);
  if (job.kind === "ASSEMBLE") rows.push(["Số clip", p.clips?.length ?? 0], ["Số câu thoại", p.lines?.length ?? 0]);
  if (preset) rows.push(["Preset", preset.name]);
  rows.push(["Credit", formatCredit(job.cost.toNumber())], ["Tạo lúc", formatDate(job.createdAt)]);
  if (job.finishedAt) rows.push(["Xong lúc", formatDate(job.finishedAt)]);
  if (job.expiresAt) rows.push(["Lưu đến", formatDate(job.expiresAt)]);
  const progress = (job as unknown as { progress?: number }).progress;

  return (
    <div className="px-3 pt-3 pb-10 sm:px-5 lg:px-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/library" className="press inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg">
          <Icon name="arrowLeft" size={16} /> Thư viện
        </Link>
        <Badge tone={STATUS_TONE[job.status]} dot>
          {STATUS_LABEL[job.status]}
        </Badge>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <MediaViewer job={{ id: job.id, kind: job.kind, status: job.status, resultUrls: job.resultUrls, prompt: job.prompt, aspect, progress }} />
        <aside className="space-y-5 self-start rounded-m4 bg-s1 p-5 hairline lg:sticky lg:top-[72px]">
          <div className="space-y-2">
            <h2 className="t-label">{job.kind === "ASSEMBLE" ? "Lời thoại" : "Prompt"}</h2>
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-fg/90">{job.prompt}</p>
          </div>
          {job.status === "FAILED" && (
            <Notice tone="danger" icon="alert">
              Tạo thất bại{job.error ? `: ${jobErrorText(job.error)}` : ""}. Credit đã được hoàn.
            </Notice>
          )}
          {job.inputUrl && (
            <div className="space-y-2">
              <h2 className="t-label">{job.kind === "VIDEO" ? "Khung đầu" : "Tham chiếu"}</h2>
              <img src={job.inputUrl} alt="Ảnh đầu vào" className="h-24 w-24 rounded-m1 object-cover hairline" />
            </div>
          )}
          <dl className="divide-y divide-line text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right font-medium text-fg/90">{v}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>
    </div>
  );
}
