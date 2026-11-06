import { EngineHealth } from "@/components/admin/EngineHealth";
import { EntityForm } from "@/components/admin/EntityForm";
import { cardClass } from "@/components/admin/format";
import { getAdminSettings } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminSettingsPage() {
  await adminPage();
  const settings = await getAdminSettings();

  return (
    <>
      <h1 className="text-xl font-semibold">Cài đặt</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-sm font-medium text-neutral-500">Bảo trì</h2>
          <p className="text-sm text-neutral-600">Khi bật, người dùng không tạo được tác vụ mới.</p>
          <EntityForm
            url="/api/admin/settings"
            method="PATCH"
            initial={{ maintenance: Boolean(settings.maintenance) }}
            fields={[{ name: "maintenance", label: "Bật chế độ bảo trì", type: "checkbox" }]}
          />
        </section>
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-sm font-medium text-neutral-500">AI viết prompt</h2>
          <EntityForm
            url="/api/admin/settings"
            method="PATCH"
            nest="prompt_writer"
            initial={settings.prompt_writer ?? { provider: "agy", model: "" }}
            fields={[
              {
                name: "provider",
                label: "Engine",
                type: "select",
                options: [
                  { value: "agy", label: "agy" },
                  { value: "codex", label: "codex" },
                ],
              },
              { name: "model", label: "Model", type: "text", placeholder: "claude-sonnet-4-6" },
            ]}
          />
        </section>
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-sm font-medium text-neutral-500">Gói Credit lẻ</h2>
          <EntityForm
            url="/api/admin/settings"
            method="PATCH"
            initial={{ credit_packs: settings.credit_packs ?? [] }}
            fields={[
              {
                name: "credit_packs",
                label: "Danh sách gói (JSON)",
                type: "json",
                hint: 'Mỗi gói {"credits": số Credit, "price": giá VND}',
              },
            ]}
          />
        </section>
        <section className={`${cardClass} space-y-3`}>
          <h2 className="text-sm font-medium text-neutral-500">Trạng thái engine</h2>
          <p className="text-xs text-neutral-500">URL và API key muse2api đặt trong biến môi trường MUSE_API_URL / MUSE_API_KEY.</p>
          <EngineHealth />
        </section>
      </div>
    </>
  );
}
