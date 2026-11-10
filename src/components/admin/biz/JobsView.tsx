"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { DataList, Mono, PageHeader, Pager, Progress, UrlFilters } from "@/components/admin/kit";
import { KIND_ICON, KIND_LABEL, durationSec, formatDateTime } from "@/components/admin/format";
import type { Plain } from "@/components/admin/plain";
import { Badge } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { STATUS_LABEL, STATUS_TONE, api, formatCredit, isVideoUrl, jobErrorText } from "@/lib/api-client";
import type { listAdminJobs } from "@/server/services/admin";

type Data = Plain<Awaited<ReturnType<typeof listAdminJobs>>>;
export type AdminJobRow = Data["items"][number];

// Xem kết quả job (ảnh / video), có nút mở tab mới.
export function ResultModal({ job, onClose }: { job: { id: string; prompt: string; resultUrls: string[] } | null; onClose: () => void }) {
  const [i, setI] = useState(0);
  const urls = job?.resultUrls ?? [];
  const url = urls[Math.min(i, urls.length - 1)];
  return (
    <Modal open={job !== null} onClose={() => (setI(0), onClose())} size="lg" title="Kết quả">
      {url && (
        <div className="space-y-3">
          <div className="flex max-h-[64dvh] items-center justify-center overflow-hidden rounded-m2 bg-black">
            {isVideoUrl(url) ? (
              <video key={url} src={url} controls autoPlay muted playsInline className="max-h-[64dvh] w-auto" />
            ) : (
              <img src={url} alt="" className="max-h-[64dvh] w-auto object-contain" />
            )}
          </div>
          <div className="flex items-center gap-2">
            {urls.length > 1 &&
              urls.map((u, n) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setI(n)}
                  className={`press h-8 w-8 rounded-m1 text-xs font-semibold ${n === i ? "bg-fg text-bg" : "bg-white/[.06] text-muted"}`}
                >
                  {n + 1}
                </button>
              ))}
            <p className="line-clamp-2 min-w-0 flex-1 text-xs text-muted">{job?.prompt}</p>
            <a href={url} target="_blank" rel="noreferrer" className="press inline-flex h-8 items-center gap-1.5 rounded-m1 px-3 text-[13px] text-fg/85 hover:bg-white/[.06]">
              <Icon name="external" size={15} />
              Mở
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function JobsView({ data, models }: { data: Data; models: { id: string; name: string }[] }) {
  const router = useRouter();
  const { run, isBusy } = useAction();
  const [view, setView] = useState<AdminJobRow | null>(null);
  const [cancel, setCancel] = useState<AdminJobRow | null>(null);

  async function act(j: AdminJobRow, action: "cancel" | "retry") {
    const ok = await run(j.id, () => api(`/api/admin/jobs/${j.id}`, jsonInit("POST", { action })), {
      success: action === "cancel" ? "Đã hủy · hoàn Credit" : "Đã chạy lại",
    });
    setCancel(null);
    if (ok) router.refresh();
  }

  return (
    <>
      <PageHeader
        icon="list"
        title="Tác vụ"
        sub={`${data.total.toLocaleString("vi-VN")} tác vụ`}
        actions={<Button size="sm" variant="ghost" icon="refresh" onClick={() => router.refresh()}>Làm mới</Button>}
      />
      <UrlFilters
        fields={[
          { name: "user", type: "search", placeholder: "Email người dùng" },
          {
            name: "modelId",
            type: "select",
            label: "Model",
            options: [{ value: "", label: "Mọi model" }, ...models.map((m) => ({ value: m.id, label: m.name }))],
          },
          {
            name: "kind",
            type: "chips",
            options: [
              { value: "", label: "Mọi loại" },
              { value: "IMAGE", label: "Ảnh" },
              { value: "VIDEO", label: "Video" },
              { value: "ASSEMBLE", label: "Ghép" },
            ],
          },
          {
            name: "status",
            type: "chips",
            options: [{ value: "", label: "Mọi trạng thái" }, ...(Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))],
          },
        ]}
      />
      <DataList<AdminJobRow>
        rows={data.items}
        rowKey={(j) => j.id}
        cols={[
          { key: "time", label: "Thời gian", cell: (j) => <span className="whitespace-nowrap text-muted">{formatDateTime(j.createdAt)}</span> },
          { key: "user", label: "Người dùng", cell: (j) => <span className="block max-w-48 truncate">{j.user.email}</span> },
          {
            key: "model",
            label: "Model",
            cell: (j) => (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Icon name={KIND_ICON[j.kind]} size={15} className="text-muted" />
                {j.model.displayName || j.model.name}
              </span>
            ),
          },
          {
            key: "prompt",
            label: "Prompt",
            mobile: "title",
            cell: (j) => (
              <span className="block max-w-sm">
                <span className="line-clamp-2">{j.prompt || <span className="text-dim">{KIND_LABEL[j.kind]}</span>}</span>
                {j.storyId && <Mono className="text-[11px] text-dim">story · cảnh {(j.shotIndex ?? 0) + 1}</Mono>}
              </span>
            ),
          },
          { key: "cost", label: "Credit", align: "right", cell: (j) => <span className="tabular-nums">{formatCredit(j.cost)}</span> },
          {
            key: "status",
            label: "Trạng thái",
            cell: (j) => {
              const sec = durationSec(j.startedAt, j.finishedAt);
              return (
                <span className="inline-flex min-w-28 flex-col items-end gap-1 md:items-start">
                  <span className="flex items-center gap-1.5">
                    <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                    {sec !== null && <span className="text-xs text-dim tabular-nums">{sec}s</span>}
                  </span>
                  {j.status === "RUNNING" && (
                    <span className="w-28">
                      <Progress value={j.progress} />
                    </span>
                  )}
                  {j.error && <span className="max-w-56 text-xs break-words text-danger">{jobErrorText(j.error)}</span>}
                </span>
              );
            },
          },
          {
            key: "act",
            label: "",
            align: "right",
            mobile: "actions",
            cell: (j) => (
              <span className="inline-flex justify-end gap-1.5">
                {j.status === "PENDING" && (
                  <Button size="sm" variant="danger" onClick={() => setCancel(j)}>
                    Hủy
                  </Button>
                )}
                {j.status === "FAILED" && (
                  <Button size="sm" variant="outline" icon="refresh" loading={isBusy(j.id)} onClick={() => act(j, "retry")}>
                    Chạy lại
                  </Button>
                )}
                {j.resultUrls[0] && (
                  <Button size="sm" variant="ghost" icon="eye" onClick={() => setView(j)}>
                    Xem
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      <Pager page={data.page} total={data.total} pageSize={data.pageSize} />
      <ResultModal job={view} onClose={() => setView(null)} />
      <ConfirmDialog
        open={cancel !== null}
        title="Hủy tác vụ?"
        body="Credit đã giữ sẽ được hoàn."
        confirmLabel="Hủy tác vụ"
        danger
        busy={cancel ? isBusy(cancel.id) : false}
        onConfirm={() => cancel && act(cancel, "cancel")}
        onClose={() => setCancel(null)}
      />
    </>
  );
}
