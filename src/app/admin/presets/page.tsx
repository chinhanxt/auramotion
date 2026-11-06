import type { Preset } from "@prisma/client";
import { ActionButton } from "@/components/admin/ActionButton";
import { Badge } from "@/components/admin/DataTable";
import { EntityForm, type Field } from "@/components/admin/EntityForm";
import { cardClass } from "@/components/admin/format";
import { listPresets } from "@/server/services/admin";
import { adminPage } from "../guard";

const FIELDS: Field[] = [
  {
    name: "kind",
    label: "Loại",
    type: "select",
    options: [
      { value: "STYLE", label: "Phong cách (ảnh)" },
      { value: "CAMERA", label: "Camera (video)" },
    ],
  },
  { name: "name", label: "Tên", type: "text" },
  { name: "thumbnailUrl", label: "Ảnh demo (URL)", type: "text", placeholder: "/media/... hoặc https://...", wide: true },
  { name: "promptSuffix", label: "Đoạn prompt thêm vào", type: "textarea" },
  { name: "enabled", label: "Đang bật", type: "checkbox" },
];

const GROUPS = [
  { kind: "STYLE", title: "Phong cách (ảnh)" },
  { kind: "CAMERA", title: "Camera (video)" },
] as const;

function PresetCard({ preset }: { preset: Preset }) {
  return (
    <details className={cardClass}>
      <summary className="flex cursor-pointer items-center gap-3 text-sm">
        {preset.thumbnailUrl ? (
          <img src={preset.thumbnailUrl} alt="" className="h-10 w-10 rounded-md border border-neutral-200 object-cover" />
        ) : (
          <span className="h-10 w-10 rounded-md bg-neutral-100" />
        )}
        <span className="min-w-0 flex-1">
          <span className="font-medium">{preset.name}</span>
          <span className="block truncate text-xs text-neutral-500">{preset.promptSuffix}</span>
        </span>
        {!preset.enabled && <Badge className="bg-neutral-200 text-neutral-700">Tắt</Badge>}
      </summary>
      <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
        <EntityForm
          url="/api/admin/presets"
          method="PATCH"
          extra={{ id: preset.id }}
          fields={FIELDS}
          initial={{ ...preset }}
        />
        <ActionButton
          url={`/api/admin/presets?id=${preset.id}`}
          method="DELETE"
          label="Xóa preset"
          danger
          confirmText={`Xóa preset "${preset.name}"? Preset đã có tác vụ dùng sẽ chỉ bị tắt.`}
        />
      </div>
    </details>
  );
}

export default async function AdminPresetsPage() {
  await adminPage();
  const presets = await listPresets();

  return (
    <>
      <h1 className="text-xl font-semibold">Preset</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        {GROUPS.map((g) => (
          <section key={g.kind} className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-500">{g.title}</h2>
            {presets
              .filter((p) => p.kind === g.kind)
              .map((p) => (
                <PresetCard key={p.id} preset={p} />
              ))}
          </section>
        ))}
      </div>
      <section className={`${cardClass} space-y-3`}>
        <h2 className="text-sm font-medium text-neutral-500">Thêm preset</h2>
        <EntityForm
          url="/api/admin/presets"
          method="POST"
          submitLabel="Thêm"
          resetOnSuccess
          fields={FIELDS}
          initial={{ kind: "STYLE", enabled: true }}
        />
      </section>
    </>
  );
}
