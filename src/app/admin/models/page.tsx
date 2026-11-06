import type { AiModel } from "@prisma/client";
import { ActionButton } from "@/components/admin/ActionButton";
import { Badge } from "@/components/admin/DataTable";
import { EntityForm, type Field } from "@/components/admin/EntityForm";
import { KIND_LABEL, PLAN_RANK_LABEL, cardClass } from "@/components/admin/format";
import { formatCredit } from "@/lib/api-client";
import { listModels } from "@/server/services/admin";
import { adminPage } from "../guard";

const FIELDS: Field[] = [
  { name: "name", label: "Tên hiển thị", type: "text" },
  {
    name: "provider",
    label: "Engine",
    type: "select",
    options: [
      { value: "MUSE", label: "MUSE" },
      { value: "AGY", label: "Gemini (agy)" },
      { value: "CODEX", label: "Codex" },
      { value: "LOCAL", label: "Ghép video (máy chủ)" },
    ],
  },
  { name: "engineModel", label: "Model của engine", type: "text", hint: "Codex để trống = model mặc định" },
  {
    name: "kind",
    label: "Loại tác vụ",
    type: "select",
    options: [
      { value: "IMAGE", label: "Ảnh" },
      { value: "VIDEO", label: "Video" },
      { value: "ASSEMBLE", label: "Ghép video" },
    ],
  },
  {
    name: "minPlanRank",
    label: "Gói tối thiểu",
    type: "select",
    options: [0, 1, 2].map((r) => ({ value: String(r), label: PLAN_RANK_LABEL[r] })),
  },
  { name: "baseCost", label: "Giá gốc (Credit)", type: "number" },
  { name: "sort", label: "Thứ tự", type: "number", step: "1" },
  { name: "enabled", label: "Đang bật", type: "checkbox" },
  {
    name: "options",
    label: "Tham số hỗ trợ (JSON)",
    type: "json",
    hint: 'Ví dụ {"aspectRatios":["1:1","9:16"],"counts":[1,2,4],"durations":[5,10],"maxRefs":1}',
  },
];

function formValues(m: AiModel): Record<string, unknown> {
  return {
    name: m.name,
    provider: m.provider,
    engineModel: m.engineModel,
    kind: m.kind,
    minPlanRank: m.minPlanRank,
    baseCost: m.baseCost.toNumber(),
    sort: m.sort,
    enabled: m.enabled,
    options: m.options,
  };
}

export default async function AdminModelsPage() {
  await adminPage();
  const models = await listModels();

  return (
    <>
      <h1 className="text-xl font-semibold">Engine / model</h1>
      <div className="space-y-3">
        {models.map((m) => (
          <details key={m.id} className={cardClass}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-neutral-900">{m.name}</span>
              <span className="text-neutral-500">
                {KIND_LABEL[m.kind]} · {m.provider} {m.engineModel && `· ${m.engineModel}`} · {formatCredit(m.baseCost.toNumber())} Credit
              </span>
              {m.minPlanRank > 0 && <Badge className="bg-neutral-100 text-neutral-700">{PLAN_RANK_LABEL[m.minPlanRank]}</Badge>}
              {m.enabled ? (
                <Badge className="bg-green-100 text-green-800">Bật</Badge>
              ) : (
                <Badge className="bg-neutral-200 text-neutral-700">Tắt</Badge>
              )}
            </summary>
            <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
              <EntityForm url="/api/admin/models" method="PATCH" extra={{ id: m.id }} fields={FIELDS} initial={formValues(m)} />
              <ActionButton
                url={`/api/admin/models?id=${m.id}`}
                method="DELETE"
                label="Xóa engine"
                danger
                confirmText={`Xóa "${m.name}"? Engine đã có tác vụ sẽ chỉ bị tắt.`}
              />
            </div>
          </details>
        ))}
      </div>
      <section className={`${cardClass} space-y-3`}>
        <h2 className="text-sm font-medium text-neutral-500">Thêm engine</h2>
        <EntityForm
          url="/api/admin/models"
          method="POST"
          submitLabel="Thêm"
          resetOnSuccess
          fields={FIELDS}
          initial={{ provider: "MUSE", kind: "IMAGE", minPlanRank: 0, baseCost: 1, sort: 0, enabled: true, options: { aspectRatios: ["1:1"], counts: [1] } }}
        />
      </section>
    </>
  );
}
