import { DataTable } from "@/components/admin/DataTable";
import { EntityForm } from "@/components/admin/EntityForm";
import { KIND_LABEL, cardClass } from "@/components/admin/format";
import { formatCredit } from "@/lib/api-client";
import { getCreditRules } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminCreditRulesPage() {
  await adminPage();
  const { models, voiceLineCost } = await getCreditRules();

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Bảng giá Credit</h1>
        <p className="text-sm text-neutral-600">
          Ảnh = giá gốc × số ảnh · Video = giá gốc × số giây / 5 · Ghép video = giá gốc + số câu × giá mỗi câu.
        </p>
      </div>
      <section className={`${cardClass} space-y-2`}>
        <h2 className="text-sm font-medium text-neutral-500">Giá mỗi câu lời thoại (ghép video)</h2>
        <EntityForm
          inline
          url="/api/admin/settings"
          method="PATCH"
          initial={{ voice_line_cost: voiceLineCost }}
          fields={[{ name: "voice_line_cost", label: "Credit / câu", type: "number" }]}
        />
      </section>
      <DataTable
        rows={models}
        rowKey={(m) => m.id}
        columns={[
          {
            header: "Engine",
            cell: (m) => (
              <span>
                <span className="font-medium">{m.name}</span>
                <span className="block text-xs text-neutral-500">
                  {KIND_LABEL[m.kind]}
                  {!m.enabled && " · đang tắt"}
                </span>
              </span>
            ),
          },
          {
            header: "Giá gốc",
            cell: (m) => (
              <EntityForm
                inline
                url="/api/admin/models"
                method="PATCH"
                extra={{ id: m.id }}
                initial={{ baseCost: m.baseCost }}
                fields={[{ name: "baseCost", label: "Credit", type: "number" }]}
              />
            ),
          },
          {
            header: "Xem trước",
            cell: (m) => (
              <ul className="space-y-0.5">
                {m.previews.map((p) => (
                  <li key={p.label} className="flex justify-between gap-4 whitespace-nowrap">
                    <span className="text-neutral-600">{p.label}</span>
                    <span className="font-medium">{formatCredit(p.cost)} Credit</span>
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
    </>
  );
}
