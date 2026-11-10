"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { CodeArea, FieldRow, NumberInput, PageHeader, TextInput } from "@/components/admin/kit";
import { AuraBar, Badge, Empty } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { api, jobErrorText, type JobStatus } from "@/lib/api-client";

export type PresetKind = "STYLE" | "CAMERA";
export type Preset = {
  id: string;
  kind: PresetKind;
  name: string;
  promptSuffix: string;
  thumbnailUrl: string | null;
  enabled: boolean;
  slug: string | null;
  category: string;
  description: string;
  cover: string | null;
  palette: string[];
  sort: number;
  featured: boolean;
};

type Draft = Omit<Preset, "id"> & { id?: string };
type CoverJob = { id: string; status: JobStatus; progress: number; error: string | null };

const FALLBACK = "linear-gradient(135deg,#1a1a20 0%,#2a2140 50%,#3a1f35 100%)";
const KIND_LABEL: Record<PresetKind, string> = { STYLE: "Theme", CAMERA: "Camera" };

const isGradient = (v: string) => /^(repeating-)?(linear|radial|conic)-gradient\(/.test(v.trim());

// Nền bìa: gradient → background; URL → ảnh; không có → gradient trung tính.
export function coverStyle(p: Pick<Preset, "cover" | "thumbnailUrl">): React.CSSProperties {
  const c = p.cover?.trim();
  if (c && isGradient(c)) return { background: c };
  const url = c || p.thumbnailUrl;
  if (url) return { backgroundImage: `url("${url.replace(/"/g, "")}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { background: FALLBACK };
}

function sortPresets(l: Preset[]) {
  return [...l].sort((a, b) => a.kind.localeCompare(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name));
}

function emptyDraft(kind: PresetKind): Draft {
  return {
    kind,
    name: "",
    promptSuffix: "",
    thumbnailUrl: null,
    enabled: true,
    slug: null,
    category: "",
    description: "",
    cover: null,
    palette: [],
    sort: 0,
    featured: false,
  };
}

export function PresetsView({ initial }: { initial: Preset[] }) {
  const [presets, setPresets] = useState(() => sortPresets(initial));
  useEffect(() => setPresets(sortPresets(initial)), [initial]);
  const [kind, setKind] = useState<"ALL" | PresetKind>("ALL");
  const [cat, setCat] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [jobs, setJobs] = useState<Record<string, CoverJob>>({});
  const toast = useToast();
  const { run } = useAction();

  const byKind = presets.filter((p) => kind === "ALL" || p.kind === kind);
  const categories = useMemo(() => [...new Set(byKind.map((p) => p.category).filter(Boolean))].sort(), [byKind]);
  const shown = byKind.filter((p) => !cat || p.category === cat);
  useEffect(() => {
    if (cat && !categories.includes(cat)) setCat("");
  }, [categories, cat]);

  const reload = useCallback(async () => {
    const list = await api<Preset[]>("/api/admin/presets").catch(() => null);
    if (list) setPresets(sortPresets(list));
    return list;
  }, []);

  // Theo dõi job tạo bìa: 3 s / lần.
  const pending = Object.entries(jobs).filter(([, j]) => j.status === "PENDING" || j.status === "RUNNING");
  const pendingKey = pending.map(([id, j]) => `${id}:${j.id}`).join(",");
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  useEffect(() => {
    if (!pendingKey) return;
    const t = setInterval(async () => {
      for (const [presetId, j] of Object.entries(jobsRef.current)) {
        if (j.status !== "PENDING" && j.status !== "RUNNING") continue;
        const res = await api<{ job: CoverJob }>(`/api/admin/jobs/${j.id}`).catch(() => null);
        if (!res) continue;
        const next = res.job;
        setJobs((m) => ({ ...m, [presetId]: next }));
        if (next.status === "SUCCEEDED") {
          const list = await reload();
          const p = list?.find((x) => x.id === presetId);
          if (p) setEditing((e) => (e?.id === presetId ? { ...e, cover: p.cover } : e));
          toast.success("Bìa mới đã xong", { body: p?.name });
        } else if (next.status === "FAILED" || next.status === "CANCELED") {
          toast.error("Tạo bìa lỗi", { body: next.error ? jobErrorText(next.error) : undefined });
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, [pendingKey, reload, toast]);

  async function makeCover(id: string) {
    const res = await run(`cover:${id}`, () => api<{ job: CoverJob }>(`/api/admin/presets/${id}/cover`, jsonInit("POST")), {
      success: "Đang tạo bìa bằng Muse",
    });
    if (res) setJobs((m) => ({ ...m, [id]: { ...res.job, progress: res.job.progress ?? 0 } }));
  }

  function saved(p: Preset) {
    setPresets((l) => sortPresets(l.some((x) => x.id === p.id) ? l.map((x) => (x.id === p.id ? p : x)) : [...l, p]));
    setEditing({ ...p });
  }

  const count = (k: PresetKind) => presets.filter((p) => p.kind === k).length;

  return (
    <>
      <PageHeader
        icon="palette"
        title="Theme & Camera"
        sub={`${count("STYLE")} theme · ${count("CAMERA")} camera · ${presets.filter((p) => p.featured).length} nổi bật`}
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setEditing(emptyDraft(kind === "CAMERA" ? "CAMERA" : "STYLE"))}>
            Thêm
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          ariaLabel="Loại"
          value={kind}
          onChange={setKind}
          options={[
            { value: "ALL" as const, label: `Tất cả · ${presets.length}` },
            { value: "STYLE" as const, label: <><Icon name="palette" size={14} />Theme</> },
            { value: "CAMERA" as const, label: <><Icon name="camera" size={14} />Camera</> },
          ]}
        />
        {categories.length > 0 && (
          <div className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1">
            {["", ...categories].map((c) => (
              <button
                key={c || "all"}
                type="button"
                aria-pressed={cat === c}
                onClick={() => setCat(c)}
                className={cx(
                  "press h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap",
                  cat === c ? "bg-fg text-bg" : "bg-white/[.05] text-fg/75 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-fg",
                )}
              >
                {c || "Mọi nhóm"}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty icon="palette" title="Trống" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {shown.map((p, i) => {
            const job = jobs[p.id];
            const busy = job && (job.status === "PENDING" || job.status === "RUNNING");
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setEditing({ ...p })}
                className={cx("reveal lift group relative overflow-hidden rounded-m3 bg-s1 text-left hairline", !p.enabled && "opacity-45")}
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="relative aspect-[4/5]" style={coverStyle(p)}>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <div className="absolute top-2 left-2 flex gap-1">
                    <Badge tone="neutral" className="bg-black/50 backdrop-blur">
                      <Icon name={p.kind === "CAMERA" ? "camera" : "palette"} size={11} />
                      {KIND_LABEL[p.kind]}
                    </Badge>
                    {!p.enabled && <Badge tone="neutral" className="bg-black/50">Tắt</Badge>}
                  </div>
                  {p.featured && (
                    <span className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-accent-ink">
                      <Icon name="star" size={14} strokeWidth={2} />
                    </span>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    {p.palette.length > 0 && (
                      <div className="mb-2 flex -space-x-1">
                        {p.palette.map((c, k) => (
                          <span key={k} className="h-3.5 w-3.5 rounded-full ring-2 ring-black/60" style={{ background: c }} />
                        ))}
                      </div>
                    )}
                    <p className="truncate text-[14px] font-semibold text-white">{p.name}</p>
                    <p className="truncate text-xs text-white/60">{p.category || p.slug || "—"}</p>
                  </div>
                  {busy && (
                    <div className="absolute inset-x-3 bottom-1.5">
                      <AuraBar value={job.progress} />
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <PresetEditor
        draft={editing}
        job={editing?.id ? jobs[editing.id] : undefined}
        onClose={() => setEditing(null)}
        onSaved={saved}
        onCover={makeCover}
        onDeleted={(id, deleted) => {
          if (deleted) setPresets((l) => l.filter((x) => x.id !== id));
          else setPresets((l) => l.map((x) => (x.id === id ? { ...x, enabled: false } : x)));
          setEditing(null);
        }}
      />
    </>
  );
}

function PresetEditor({
  draft,
  job,
  onClose,
  onSaved,
  onCover,
  onDeleted,
}: {
  draft: Draft | null;
  job?: CoverJob;
  onClose: () => void;
  onSaved: (p: Preset) => void;
  onCover: (id: string) => void;
  onDeleted: (id: string, deleted: boolean) => void;
}) {
  const [d, setD] = useState<Draft | null>(draft);
  const [confirm, setConfirm] = useState(false);
  const { run, isBusy } = useAction();
  const toast = useToast();
  useEffect(() => {
    if (draft) setD(draft);
  }, [draft]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const isNew = !d?.id;
  const coverBusy = job && (job.status === "PENDING" || job.status === "RUNNING");

  async function save() {
    if (!d) return;
    const body = { ...d, slug: d.slug?.trim() || null, cover: d.cover?.trim() || null, thumbnailUrl: d.thumbnailUrl?.trim() || null };
    const res = await run("save", () => api<Preset>("/api/admin/presets", jsonInit(isNew ? "POST" : "PATCH", body)), {
      success: isNew ? "Đã tạo" : "Đã lưu",
    });
    if (res) onSaved(res);
  }

  async function remove() {
    if (!d?.id) return;
    const id = d.id;
    const res = await run("del", () => api<{ deleted: boolean }>(`/api/admin/presets?id=${encodeURIComponent(id)}`, jsonInit("DELETE")), { silent: true });
    setConfirm(false);
    if (!res) return;
    if (res.deleted) toast.success("Đã xóa");
    else toast.info("Đã tắt (đang được dùng)");
    onDeleted(id, res.deleted);
  }

  function setColor(i: number, c: string) {
    if (!d) return;
    set("palette", d.palette.map((x, k) => (k === i ? c : x)));
  }

  return (
    <Drawer
      open={Boolean(draft)}
      onClose={onClose}
      size="lg"
      title={d ? (isNew ? (d.kind === "CAMERA" ? "Camera mới" : "Theme mới") : d.name || "Preset") : ""}
      subtitle={d && !isNew ? `${KIND_LABEL[d.kind]}${d.slug ? ` · ${d.slug}` : ""}` : undefined}
      footer={
        d && (
          <div className="flex items-center gap-2">
            {!isNew && (
              <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirm(true)}>
                Xóa
              </Button>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
              Đóng
            </Button>
            <Button variant="primary" size="sm" icon="check" loading={isBusy("save")} onClick={save}>
              {isNew ? "Tạo" : "Lưu"}
            </Button>
          </div>
        )
      }
    >
      {d && (
        <div className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
            <div className="space-y-2">
              <div className="relative aspect-[4/5] overflow-hidden rounded-m3 hairline" style={coverStyle(d)}>
                {coverBusy && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 p-4 backdrop-blur-[2px]">
                    <Icon name="sparkle" size={20} className="animate-pulse text-accent" />
                    <span className="text-xs text-white/80 tabular-nums">{job.progress > 0 ? `${job.progress}%` : "Đang chờ"}</span>
                    <AuraBar value={job.progress} className="w-full" />
                  </div>
                )}
              </div>
              {!isNew && (
                <Button variant="glass" size="sm" block icon="wand" loading={isBusy(`cover:${d.id}`) || Boolean(coverBusy)} onClick={() => d.id && onCover(d.id)}>
                  Tạo bìa bằng Muse
                </Button>
              )}
            </div>
            <div className="grid content-start gap-3 sm:grid-cols-2">
              <FieldRow label="Loại">
                <Select inputSize="sm" value={d.kind} onChange={(e) => set("kind", e.target.value as PresetKind)}>
                  <option value="STYLE">Theme</option>
                  <option value="CAMERA">Camera</option>
                </Select>
              </FieldRow>
              <FieldRow label="Tên">
                <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} />
              </FieldRow>
              <FieldRow label="Slug">
                <TextInput className="font-mono" value={d.slug ?? ""} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="son-mai" />
              </FieldRow>
              <FieldRow label="Nhóm">
                <TextInput value={d.category} onChange={(e) => set("category", e.target.value)} placeholder="Việt Nam" />
              </FieldRow>
              <FieldRow label="Thứ tự">
                <NumberInput value={d.sort} step="1" onChange={(v) => set("sort", Number(v) || 0)} />
              </FieldRow>
              <div className="space-y-0.5 self-end">
                <Switch checked={d.featured} onChange={(v) => set("featured", v)} label="Nổi bật" icon="star" />
                <Switch checked={d.enabled} onChange={(v) => set("enabled", v)} label="Bật" icon="eye" />
              </div>
            </div>
          </div>

          <FieldRow label="Mô tả">
            <TextInput value={d.description} onChange={(e) => set("description", e.target.value)} />
          </FieldRow>
          <FieldRow label="Prompt thêm vào">
            <CodeArea rows={4} value={d.promptSuffix} onChange={(e) => set("promptSuffix", e.target.value)} />
          </FieldRow>
          <FieldRow label="Bìa" hint="CSS gradient hoặc URL ảnh">
            <div className="flex gap-2">
              <span className="h-9 w-9 shrink-0 rounded-m1 hairline" style={coverStyle({ cover: d.cover, thumbnailUrl: null })} />
              <TextInput
                className="font-mono"
                value={d.cover ?? ""}
                onChange={(e) => set("cover", e.target.value)}
                placeholder="linear-gradient(135deg,#7c5cff,#ff4fd8)"
              />
            </div>
          </FieldRow>
          <FieldRow label="Ảnh demo">
            <TextInput className="font-mono" value={d.thumbnailUrl ?? ""} onChange={(e) => set("thumbnailUrl", e.target.value)} placeholder="/media/…" />
          </FieldRow>

          <div>
            <p className="mb-1.5 text-[13px] font-medium text-fg/75">Bảng màu</p>
            <div className="flex flex-wrap items-center gap-2">
              {d.palette.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-m1 bg-white/[.04] py-1 pr-1 pl-1 hairline">
                  <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-[8px] ring-1 ring-white/15" style={{ background: c }}>
                    <input
                      type="color"
                      value={/^#[0-9a-f]{6}$/i.test(c) ? c : "#000000"}
                      onChange={(e) => setColor(i, e.target.value)}
                      className="absolute inset-0 cursor-pointer opacity-0"
                      aria-label={`Màu ${i + 1}`}
                    />
                  </label>
                  <input
                    value={c}
                    onChange={(e) => setColor(i, e.target.value)}
                    className="w-[74px] bg-transparent font-mono text-[12px] text-fg/85 outline-none"
                    maxLength={7}
                  />
                  <IconButton icon="close" label="Bỏ" size="sm" tip={false} className="h-6 w-6" onClick={() => set("palette", d.palette.filter((_, k) => k !== i))} />
                </div>
              ))}
              {d.palette.length < 5 && (
                <Button variant="outline" size="sm" icon="plus" onClick={() => set("palette", [...d.palette, "#7c5cff"])}>
                  Màu
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="Xóa preset?"
        body={<>{d?.name} — đang được dùng thì chỉ tắt.</>}
        danger
        confirmLabel="Xóa"
        busy={isBusy("del")}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </Drawer>
  );
}
