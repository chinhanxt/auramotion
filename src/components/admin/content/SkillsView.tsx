"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { jsonInit, useAction } from "@/components/admin/hooks";
import { CodeArea, FieldRow, NumberInput, PageHeader, TextInput } from "@/components/admin/kit";
import { PLAN_RANK_LABEL, formatMs } from "@/components/admin/format";
import { Badge, Empty, Skeleton } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { api } from "@/lib/api-client";

export type SkillKind = "IMAGE" | "VIDEO" | "STORY" | "SCRIPT";
export type Skill = {
  id: string;
  slug: string;
  name: string;
  kind: SkillKind;
  description: string;
  instructions: string;
  template: string;
  minPlanRank: number;
  enabled: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

const KINDS: { value: SkillKind; label: string; icon: IconName }[] = [
  { value: "IMAGE", label: "Ảnh", icon: "image" },
  { value: "VIDEO", label: "Video", icon: "video" },
  { value: "STORY", label: "Story", icon: "story" },
  { value: "SCRIPT", label: "Kịch bản", icon: "text" },
];
const KIND_OF = Object.fromEntries(KINDS.map((k) => [k.value, k])) as Record<SkillKind, (typeof KINDS)[number]>;
const VARS = ["idea", "style", "camera", "aspect", "duration", "shots"];

type Draft = Omit<Skill, "id" | "createdAt" | "updatedAt"> & { id?: string };

function emptyDraft(kind: SkillKind): Draft {
  return { slug: "", name: "", kind, description: "", instructions: "", template: "{{idea}}", minPlanRank: 0, enabled: true, sort: 0 };
}

function sortSkills(list: Skill[]): Skill[] {
  const order = KINDS.map((k) => k.value);
  return [...list].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.sort - b.sort || a.name.localeCompare(b.name));
}

export function SkillsView({ initial }: { initial: Skill[] }) {
  const [skills, setSkills] = useState(() => sortSkills(initial));
  useEffect(() => setSkills(sortSkills(initial)), [initial]);
  const [filter, setFilter] = useState<"ALL" | SkillKind>("ALL");
  const [editing, setEditing] = useState<Draft | null>(null);
  const { run } = useAction();

  const groups = useMemo(
    () => KINDS.filter((k) => filter === "ALL" || filter === k.value).map((k) => ({ ...k, items: skills.filter((s) => s.kind === k.value) })),
    [skills, filter],
  );

  async function toggle(s: Skill, enabled: boolean) {
    setSkills((l) => l.map((x) => (x.id === s.id ? { ...x, enabled } : x)));
    const ok = await run(`t:${s.id}`, () => api<Skill>(`/api/admin/skills/${s.id}`, jsonInit("PATCH", { enabled })), {
      success: enabled ? "Đã bật" : "Đã tắt",
    });
    if (!ok) setSkills((l) => l.map((x) => (x.id === s.id ? { ...x, enabled: !enabled } : x)));
  }

  function saved(s: Skill) {
    setSkills((l) => sortSkills(l.some((x) => x.id === s.id) ? l.map((x) => (x.id === s.id ? s : x)) : [...l, s]));
    setEditing({ ...s });
  }

  return (
    <>
      <PageHeader
        icon="wand"
        title="Skill"
        sub={`${skills.length} skill · ${skills.filter((s) => s.enabled).length} bật`}
        actions={
          <Button variant="primary" size="sm" icon="plus" onClick={() => setEditing(emptyDraft(filter === "ALL" ? "IMAGE" : filter))}>
            Thêm
          </Button>
        }
      />
      <div className="no-scrollbar mb-5 overflow-x-auto">
        <Segmented
          size="sm"
          ariaLabel="Loại skill"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "ALL" as const, label: `Tất cả · ${skills.length}` },
            ...KINDS.map((k) => ({
              value: k.value,
              label: (
                <>
                  <Icon name={k.icon} size={14} />
                  {k.label}
                  <span className="text-dim tabular-nums">{skills.filter((s) => s.kind === k.value).length}</span>
                </>
              ),
            })),
          ]}
        />
      </div>

      {skills.length === 0 ? (
        <Empty icon="wand" title="Chưa có skill" action={<Button size="sm" icon="plus" onClick={() => setEditing(emptyDraft("IMAGE"))}>Thêm</Button>} />
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.value}>
              <h2 className="t-label mb-2.5 flex items-center gap-2">
                <Icon name={g.icon} size={14} />
                {g.label}
                <span className="text-dim">{g.items.length}</span>
              </h2>
              {g.items.length === 0 ? (
                <p className="rounded-m2 px-4 py-5 text-sm text-dim hairline">Trống</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {g.items.map((s, i) => (
                    <article
                      key={s.id}
                      className={cx("reveal press group flex cursor-pointer flex-col rounded-m3 bg-s1 p-4 hairline hover:bg-s2", !s.enabled && "opacity-55")}
                      style={{ "--i": i } as React.CSSProperties}
                      onClick={() => setEditing({ ...s })}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-semibold">{s.name}</p>
                          <p className="truncate font-mono text-[11.5px] text-dim">{s.slug}</p>
                        </div>
                        <div onClick={(e) => e.stopPropagation()} className="-mt-1 w-12 shrink-0">
                          <Switch checked={s.enabled} onChange={(v) => toggle(s, v)} label={<span className="sr-only">Bật</span>} />
                        </div>
                      </div>
                      <p className="mt-2 line-clamp-2 min-h-[2.5em] text-[13px] text-muted">{s.description || "—"}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {s.minPlanRank > 0 && (
                          <Badge tone="aura">
                            <Icon name="lock" size={11} />
                            {PLAN_RANK_LABEL[s.minPlanRank]}
                          </Badge>
                        )}
                        <Badge>#{s.sort}</Badge>
                        <span className="ml-auto text-xs text-dim tabular-nums">{s.template.length + s.instructions.length} ký tự</span>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <SkillEditor draft={editing} onClose={() => setEditing(null)} onSaved={saved} onDeleted={(id) => (setSkills((l) => l.filter((x) => x.id !== id)), setEditing(null))} />
    </>
  );
}

function SkillEditor({
  draft,
  onClose,
  onSaved,
  onDeleted,
}: {
  draft: Draft | null;
  onClose: () => void;
  onSaved: (s: Skill) => void;
  onDeleted: (id: string) => void;
}) {
  const [d, setD] = useState<Draft | null>(draft);
  const [confirm, setConfirm] = useState(false);
  const target = useRef<"instructions" | "template">("template");
  const refs = { instructions: useRef<HTMLTextAreaElement>(null), template: useRef<HTMLTextAreaElement>(null) };
  const { run, isBusy } = useAction();
  useEffect(() => {
    if (draft) setD(draft);
  }, [draft]);

  const isNew = !d?.id;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));

  function insertVar(name: string) {
    if (!d) return;
    const key = target.current;
    const el = refs[key].current;
    const token = `{{${name}}}`;
    const val = d[key];
    const start = el?.selectionStart ?? val.length;
    const end = el?.selectionEnd ?? val.length;
    set(key, val.slice(0, start) + token + val.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    if (!d) return;
    const { id, ...body } = d;
    const res = await run(
      "save",
      () => (id ? api<Skill>(`/api/admin/skills/${id}`, jsonInit("PATCH", body)) : api<Skill>("/api/admin/skills", jsonInit("POST", body))),
      { success: id ? "Đã lưu" : "Đã tạo" },
    );
    if (res) onSaved(res);
  }

  async function remove() {
    if (!d?.id) return;
    const id = d.id;
    const res = await run("del", () => api(`/api/admin/skills/${id}`, jsonInit("DELETE")), { success: "Đã xóa" });
    setConfirm(false);
    if (res) onDeleted(id);
  }

  return (
    <Drawer
      open={Boolean(draft)}
      onClose={onClose}
      size="lg"
      title={d ? (isNew ? "Skill mới" : d.name || "Skill") : ""}
      subtitle={d && !isNew ? <span className="font-mono">{d.slug}</span> : undefined}
      footer={
        d && (
          <div className="flex items-center gap-2">
            {!isNew && <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirm(true)}>Xóa</Button>}
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
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldRow label="Tên">
              <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="Video điện ảnh" />
            </FieldRow>
            <FieldRow label="Slug">
              <TextInput value={d.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} placeholder="video-dien-anh" className="font-mono" />
            </FieldRow>
            <FieldRow label="Loại">
              <Select inputSize="sm" value={d.kind} onChange={(e) => set("kind", e.target.value as SkillKind)}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </FieldRow>
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Gói tối thiểu">
                <Select inputSize="sm" value={String(d.minPlanRank)} onChange={(e) => set("minPlanRank", Number(e.target.value))}>
                  {[0, 1, 2].map((r) => (
                    <option key={r} value={r}>
                      {PLAN_RANK_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </FieldRow>
              <FieldRow label="Thứ tự">
                <NumberInput value={d.sort} step="1" onChange={(v) => set("sort", Number(v) || 0)} />
              </FieldRow>
            </div>
            <FieldRow label="Mô tả" className="sm:col-span-2">
              <TextInput value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Một dòng cho người dùng" />
            </FieldRow>
          </div>
          <Switch checked={d.enabled} onChange={(v) => set("enabled", v)} label="Bật" icon="eye" />

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted">Chèn</span>
              {VARS.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVar(v)}
                  className="press h-7 rounded-full bg-aura1/15 px-2.5 font-mono text-[11.5px] text-[#c4b8ff] hover:bg-aura1/25"
                >
                  {`{{${v}}}`}
                </button>
              ))}
            </div>
            <FieldRow label="Hướng dẫn (system)">
              <CodeArea
                value={d.instructions}
                rows={9}
                onFocus={() => (target.current = "instructions")}
                onChange={(e) => set("instructions", e.target.value)}
                {...{ ref: refs.instructions }}
              />
            </FieldRow>
            <FieldRow label="Template">
              <CodeArea
                value={d.template}
                rows={6}
                onFocus={() => (target.current = "template")}
                onChange={(e) => set("template", e.target.value)}
                {...{ ref: refs.template }}
              />
            </FieldRow>
          </div>

          {d.id ? <TestPanel id={d.id} /> : <p className="rounded-m2 px-4 py-3 text-[13px] text-dim hairline">Lưu trước để chạy thử</p>}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title="Xóa skill?"
        body={d?.name}
        danger
        confirmLabel="Xóa"
        busy={isBusy("del")}
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </Drawer>
  );
}

type TestResult = { text: string; data: unknown; provider: string; ms: number; prompt: string };

function TestPanel({ id }: { id: string }) {
  const [idea, setIdea] = useState("");
  const [provider, setProvider] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const { run, isBusy } = useAction();
  const busy = isBusy("test");
  useEffect(() => setResult(null), [id]);

  async function test() {
    setResult(null);
    const res = await run(
      "test",
      () => api<TestResult>(`/api/admin/skills/${id}/test`, jsonInit("POST", { idea, ...(provider ? { provider } : {}) })),
      { success: "Đã chạy thử", silent: true },
    );
    if (res) setResult(res);
  }

  return (
    <section className="rounded-m3 bg-s2/60 p-4 hairline">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Icon name="play" size={15} className="text-accent" />
        Chạy thử
      </h3>
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && idea.trim() && !busy && test()}
          placeholder="Ý tưởng…"
          className="flex-1"
        />
        <Select inputSize="sm" className="sm:w-32" value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Provider">
          <option value="">Tự động</option>
          <option value="agy">Google</option>
          <option value="codex">OpenAI</option>
          <option value="muse">Muse</option>
        </Select>
        <Button variant="primary" size="sm" icon="sparkle" className="h-9" loading={busy} disabled={!idea.trim()} onClick={test}>
          Chạy
        </Button>
      </div>

      {busy && (
        <div className="mt-4 space-y-2" aria-label="Đang chạy">
          {[92, 100, 78, 96, 60].map((w, i) => (
            <Skeleton key={i} aura={i === 0} className="h-3.5 rounded-full" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}

      {result && !busy && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="info">{result.provider}</Badge>
            <Badge>
              <Icon name="clock" size={11} />
              {formatMs(result.ms)}
            </Badge>
            <IconButton
              icon="copy"
              label="Chép"
              size="sm"
              className="ml-auto"
              onClick={() => void navigator.clipboard?.writeText(result.text)}
            />
          </div>
          <pre className="text-in max-h-80 overflow-auto rounded-m2 bg-black/30 p-3 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg/90 hairline">
            {result.text}
          </pre>
          {result.data !== null && result.data !== undefined && (
            <details className="rounded-m2 bg-black/20 hairline">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">JSON</summary>
              <pre className="max-h-72 overflow-auto px-3 pb-3 font-mono text-[12px] whitespace-pre-wrap text-ok/90">{JSON.stringify(result.data, null, 2)}</pre>
            </details>
          )}
          <details className="rounded-m2 bg-black/20 hairline">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">Prompt đã ghép</summary>
            <pre className="max-h-72 overflow-auto px-3 pb-3 font-mono text-[12px] whitespace-pre-wrap text-muted">{result.prompt}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
