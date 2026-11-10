"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { FieldRow, Mono, PageHeader, TextInput } from "@/components/admin/kit";
import { Badge, Empty } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Select } from "@/components/ui/Select";
import { api } from "@/lib/api-client";
import type { MusicTrack } from "@/server/services/admin";

type Data = { tracks: MusicTrack[]; files: string[] };

export function MusicView({ data }: { data: Data }) {
  const router = useRouter();
  const { run, isBusy } = useAction();
  const [tracks, setTracks] = useState(data.tracks);
  useEffect(() => setTracks(data.tracks), [data.tracks]);
  const [editing, setEditing] = useState<MusicTrack | "new" | null>(null);
  const [form, setForm] = useState<MusicTrack>({ id: "", name: "", file: "" });
  const [del, setDel] = useState<MusicTrack | null>(null);

  function open(t: MusicTrack | "new") {
    setEditing(t);
    setForm(t === "new" ? { id: "", name: "", file: data.files[0] ?? "" } : t);
  }

  async function save() {
    const isNew = editing === "new";
    const ok = await run("save", () => api<MusicTrack>("/api/admin/music", jsonInit(isNew ? "POST" : "PATCH", form)), {
      success: isNew ? `Đã thêm “${form.name}”` : "Đã lưu",
    });
    if (!ok) return;
    setTracks((l) => (isNew ? [...l, ok] : l.map((t) => (t.id === ok.id ? ok : t))));
    setEditing(null);
    router.refresh();
  }

  async function remove(t: MusicTrack) {
    const ok = await run("del", () => api(`/api/admin/music?id=${encodeURIComponent(t.id)}`, jsonInit("DELETE")), { success: `Đã xóa “${t.name}”` });
    setDel(null);
    if (ok) {
      setTracks((l) => l.filter((x) => x.id !== t.id));
      router.refresh();
    }
  }

  return (
    <>
      <PageHeader
        icon="music"
        title="Nhạc"
        sub={`${tracks.length} bài · ${data.files.length} file trong public/music`}
        actions={
          <Button size="sm" variant="primary" icon="plus" disabled={data.files.length === 0} onClick={() => open("new")}>
            Thêm bài
          </Button>
        }
      />

      {data.files.length === 0 && tracks.length === 0 ? (
        <div className="rounded-m3 bg-s1 hairline">
          <Empty icon="music" title="Chưa có file .mp3" hint="Chép nhạc CC0 vào public/music" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="rounded-m3 bg-s1 hairline">
          <Empty icon="music" title="Chưa có bài" action={<Button size="sm" icon="plus" onClick={() => open("new")}>Thêm bài</Button>} />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {tracks.map((t, i) => {
            const missing = !data.files.includes(t.file);
            return (
              <li key={t.id} className="reveal rounded-m3 bg-s1 p-4 hairline" style={{ "--i": i } as React.CSSProperties}>
                <div className="flex items-start gap-3">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-m1 bg-s3">
                    <span className="absolute inset-0 rounded-m1 opacity-25 blur-md" style={{ background: "var(--aura)" }} />
                    <Icon name="music" size={18} className="relative" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{t.name}</p>
                    <p className="truncate">
                      <Mono className="text-muted">{t.id}</Mono>
                      <span className="mx-1.5 text-dim">·</span>
                      <Mono className="text-dim">{t.file}</Mono>
                    </p>
                  </div>
                  {missing && (
                    <Badge tone="danger" dot>
                      Thiếu file
                    </Badge>
                  )}
                  <IconButton icon="edit" label="Sửa" size="sm" onClick={() => open(t)} />
                  <IconButton icon="trash" label="Xóa" size="sm" onClick={() => setDel(t)} />
                </div>
                {!missing && <audio controls preload="none" src={t.file} className="mt-3 h-9 w-full [color-scheme:dark]" />}
              </li>
            );
          })}
        </ul>
      )}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Thêm bài" : "Sửa bài"}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              Hủy
            </Button>
            <Button size="sm" variant="primary" icon="check" loading={isBusy("save")} disabled={!form.id || !form.name || !form.file} onClick={save}>
              Lưu
            </Button>
          </div>
        }
      >
        <div className="space-y-4 p-5">
          <FieldRow label="Mã bài" hint="chữ thường, số, gạch ngang">
            <TextInput value={form.id} disabled={editing !== "new"} placeholder="lofi-chill" onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} />
          </FieldRow>
          <FieldRow label="Tên">
            <TextInput value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </FieldRow>
          <FieldRow label="File">
            <Select inputSize="sm" value={form.file} onChange={(e) => setForm((f) => ({ ...f, file: e.target.value }))}>
              {!data.files.includes(form.file) && form.file && <option value={form.file}>{form.file} (thiếu)</option>}
              {data.files.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </FieldRow>
          {form.file && data.files.includes(form.file) && <audio key={form.file} controls preload="none" src={form.file} className="h-9 w-full [color-scheme:dark]" />}
        </div>
      </Drawer>

      <ConfirmDialog
        open={del !== null}
        title={`Xóa “${del?.name ?? ""}”?`}
        body="File mp3 vẫn giữ trong public/music."
        confirmLabel="Xóa"
        danger
        busy={isBusy("del")}
        onConfirm={() => del && remove(del)}
        onClose={() => setDel(null)}
      />
    </>
  );
}
