import { ActionButton } from "@/components/admin/ActionButton";
import { EntityForm, type Field } from "@/components/admin/EntityForm";
import { cardClass } from "@/components/admin/format";
import { listMusic } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminMusicPage() {
  await adminPage();
  const { tracks, files } = await listMusic();
  const fileField: Field = { name: "file", label: "File trong public/music", type: "select", options: files.map((f) => ({ value: f, label: f })) };

  return (
    <>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Nhạc nền</h1>
        <p className="text-sm text-neutral-600">Chép file .mp3 CC0 vào public/music rồi thêm bài ở đây.</p>
      </div>
      <div className="space-y-3">
        {tracks.length === 0 && <p className="text-sm text-neutral-500">Chưa có bài nhạc nào.</p>}
        {tracks.map((t) => (
          <details key={t.id} className={cardClass}>
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-neutral-500">{t.file}</span>
              {!files.includes(t.file) && <span className="text-xs text-red-700">Không thấy file</span>}
            </summary>
            <div className="mt-4 space-y-3 border-t border-neutral-100 pt-4">
              <audio controls preload="none" src={t.file} className="w-full max-w-md" />
              <EntityForm
                url="/api/admin/music"
                method="PATCH"
                extra={{ id: t.id }}
                initial={t}
                fields={[{ name: "name", label: "Tên", type: "text" }, fileField]}
              />
              <ActionButton url={`/api/admin/music?id=${t.id}`} method="DELETE" label="Xóa bài" danger confirmText={`Xóa bài "${t.name}"?`} />
            </div>
          </details>
        ))}
      </div>
      <section className={`${cardClass} space-y-3`}>
        <h2 className="text-sm font-medium text-neutral-500">Thêm bài</h2>
        {files.length === 0 ? (
          <p className="text-sm text-neutral-500">Chưa có file .mp3 nào trong public/music.</p>
        ) : (
          <EntityForm
            url="/api/admin/music"
            method="POST"
            submitLabel="Thêm"
            resetOnSuccess
            initial={{ file: files[0] }}
            fields={[
              { name: "id", label: "Mã bài", type: "text", placeholder: "lofi-chill", hint: "Chữ thường, số, dấu gạch ngang" },
              { name: "name", label: "Tên", type: "text" },
              fileField,
            ]}
          />
        )}
      </section>
    </>
  );
}
