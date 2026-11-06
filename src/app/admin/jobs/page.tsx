import { ActionButton } from "@/components/admin/ActionButton";
import { Badge, DataTable, Pager } from "@/components/admin/DataTable";
import { KIND_LABEL, buttonClass, formatDateTime, inputClass } from "@/components/admin/format";
import { STATUS_COLOR, STATUS_LABEL, formatCredit, type JobStatus } from "@/lib/api-client";
import { listAdminJobs, listModels } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const STATUSES = Object.keys(STATUS_LABEL) as JobStatus[];

export default async function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const statusRaw = one(sp.status);
  const status = STATUSES.includes(statusRaw as JobStatus) ? (statusRaw as JobStatus) : undefined;
  const user = one(sp.user);
  const modelId = one(sp.modelId);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [result, models] = await Promise.all([listAdminJobs({ status, user, modelId, page }), listModels()]);

  return (
    <>
      <h1 className="text-xl font-semibold">Tác vụ</h1>
      <form className="flex flex-wrap gap-2" action="/admin/jobs">
        <select name="status" defaultValue={status ?? ""} className={`${inputClass} w-40`}>
          <option value="">Mọi trạng thái</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <input name="user" defaultValue={user} placeholder="Email người dùng" className={`${inputClass} max-w-xs`} />
        <select name="modelId" defaultValue={modelId ?? ""} className={`${inputClass} w-48`}>
          <option value="">Mọi engine</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClass}>
          Lọc
        </button>
      </form>
      <DataTable
        rows={result.items}
        rowKey={(j) => j.id}
        columns={[
          { header: "Thời gian", cell: (j) => formatDateTime(j.createdAt), className: "whitespace-nowrap" },
          { header: "Người dùng", cell: (j) => j.user.email },
          {
            header: "Engine",
            cell: (j) => (
              <span>
                {j.model.name}
                <span className="block text-xs text-neutral-500">{KIND_LABEL[j.kind]}</span>
              </span>
            ),
          },
          { header: "Prompt", cell: (j) => <span className="line-clamp-2 max-w-xs">{j.prompt}</span> },
          { header: "Credit", cell: (j) => formatCredit(j.cost.toNumber()), className: "text-right" },
          {
            header: "Trạng thái",
            cell: (j) => (
              <span className="space-y-1">
                <Badge className={STATUS_COLOR[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                {j.startedAt && j.finishedAt && (
                  <span className="block text-xs text-neutral-500">
                    {Math.round((j.finishedAt.getTime() - j.startedAt.getTime()) / 1000)} giây
                  </span>
                )}
                {j.error && <span className="block max-w-xs text-xs break-words text-red-700">{j.error}</span>}
              </span>
            ),
          },
          {
            header: "Thao tác",
            cell: (j) => (
              <span className="flex flex-wrap gap-2">
                {j.status === "PENDING" && (
                  <ActionButton
                    url={`/api/admin/jobs/${j.id}`}
                    body={{ action: "cancel" }}
                    label="Hủy"
                    danger
                    confirmText="Hủy tác vụ và hoàn Credit?"
                  />
                )}
                {j.status === "FAILED" && <ActionButton url={`/api/admin/jobs/${j.id}`} body={{ action: "retry" }} label="Chạy lại" />}
                {j.resultUrls[0] && (
                  <a href={j.resultUrls[0]} target="_blank" rel="noreferrer" className="py-1.5 text-sm hover:underline">
                    Xem
                  </a>
                )}
              </span>
            ),
          },
        ]}
      />
      <Pager basePath="/admin/jobs" query={{ status, user, modelId }} page={result.page} total={result.total} pageSize={result.pageSize} />
    </>
  );
}
