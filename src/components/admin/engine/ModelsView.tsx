"use client";

import type { AiModel } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Badge, Empty } from "@/components/ui/Bits";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { api, formatCredit } from "@/lib/api-client";
import { KIND_ICON, KIND_LABEL, PLAN_RANK_LABEL } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { CodeArea, DataList, FieldRow, Mono, NumberInput, PageHeader, TextInput, type Col } from "../kit";
import type { Plain } from "../plain";

type Model = Plain<AiModel>;
type Kind = Model["kind"];
type Provider = Model["provider"];
type MuseAccount = { id: string; label: string; enabled: boolean; meta?: { kinds?: string[] } };

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "MUSE", label: "MUSE" },
  { value: "AGY", label: "Gemini (agy)" },
  { value: "CODEX", label: "Codex" },
  { value: "LOCAL", label: "Ghép (máy chủ)" },
];

const DEFAULT_OPTIONS: Record<Kind, Record<string, unknown>> = {
  IMAGE: { aspectRatios: ["1:1", "9:16", "16:9"], counts: [1, 2, 4], maxRefs: 1 },
  VIDEO: { aspectRatios: ["9:16", "16:9"], durations: [5, 10], maxRefs: 1 },
  ASSEMBLE: { aspectRatios: ["9:16", "16:9", "1:1"] },
};

type Draft = {
  id?: string;
  name: string;
  provider: Provider;
  engineModel: string;
  kind: Kind;
  minPlanRank: number;
  baseCost: string;
  sort: string;
  enabled: boolean;
  museAccount: string;
  options: string;
};

function toDraft(m?: Model): Draft {
  if (!m) {
    return { name: "", provider: "MUSE", engineModel: "", kind: "IMAGE", minPlanRank: 0, baseCost: "1", sort: "0", enabled: true, museAccount: "", options: JSON.stringify(DEFAULT_OPTIONS.IMAGE, null, 2) };
  }
  const { museAccount, ...rest } = (m.options ?? {}) as Record<string, unknown>;
  return {
    id: m.id,
    name: m.name,
    provider: m.provider,
    engineModel: m.engineModel,
    kind: m.kind,
    minPlanRank: m.minPlanRank,
    baseCost: String(Number(m.baseCost)),
    sort: String(m.sort),
    enabled: m.enabled,
    museAccount: typeof museAccount === "string" ? museAccount : "",
    options: JSON.stringify(rest, null, 2),
  };
}

function museAccountOf(m: Model): string | null {
  const v = (m.options as { museAccount?: unknown } | null)?.museAccount;
  return typeof v === "string" && v ? v : null;
}

function optionSummary(m: Model): string {
  const o = (m.options ?? {}) as { aspectRatios?: string[]; counts?: number[]; durations?: number[] };
  return [o.aspectRatios?.join(" "), o.counts && `×${o.counts.join("/")}`, o.durations && `${o.durations.join("/")}s`].filter(Boolean).join(" · ");
}

function ModelEditor({ open, model, accounts, onClose, onSaved }: { open: boolean; model?: Model; accounts?: MuseAccount[]; onClose: () => void; onSaved: (m: Model) => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(model));
  const [confirmDel, setConfirmDel] = useState(false);
  const { run, isBusy } = useAction();
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    if (open) setD(toDraft(model));
  }, [open, model]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const jsonError = useMemo(() => {
    try {
      const v = JSON.parse(d.options) as unknown;
      return v && typeof v === "object" && !Array.isArray(v) ? null : "Phải là object JSON";
    } catch {
      return "JSON không hợp lệ";
    }
  }, [d.options]);
  const pinned = d.museAccount && accounts && !accounts.some((a) => a.id === d.museAccount);

  async function save() {
    if (jsonError) return void toast.error(`Tham số: ${jsonError}`);
    const options = { ...(JSON.parse(d.options) as Record<string, unknown>), ...(d.provider === "MUSE" && d.kind !== "ASSEMBLE" && d.museAccount ? { museAccount: d.museAccount } : {}) };
    const body = {
      ...(d.id ? { id: d.id } : {}),
      name: d.name,
      provider: d.provider,
      engineModel: d.engineModel,
      kind: d.kind,
      minPlanRank: d.minPlanRank,
      baseCost: Number(d.baseCost),
      sort: Number(d.sort) || 0,
      enabled: d.enabled,
      options,
    };
    const r = await run("save", () => api<Model>("/api/admin/models", jsonInit(d.id ? "PATCH" : "POST", body)), { success: d.id ? "Đã lưu" : "Đã thêm model" });
    if (r) {
      onSaved(r);
      onClose();
      router.refresh();
    }
  }

  async function remove() {
    if (!d.id) return;
    const r = await run("del", () => api<{ deleted: boolean }>(`/api/admin/models?id=${encodeURIComponent(d.id!)}`, jsonInit("DELETE")), {
      success: (v) => (v.deleted ? "Đã xóa" : "Đã tắt (có tác vụ)"),
    });
    setConfirmDel(false);
    if (r) {
      onClose();
      router.refresh();
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={d.id ? d.name || "Model" : "Thêm model"}
      subtitle={d.id ? <Mono>{d.id}</Mono> : undefined}
      footer={
        <div className="flex items-center justify-between gap-2">
          {d.id ? (
            <Button variant="danger" size="sm" icon="trash" onClick={() => setConfirmDel(true)}>
              Xóa
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Hủy
            </Button>
            <Button variant="primary" size="sm" icon="check" loading={isBusy("save")} disabled={!d.name.trim()} onClick={() => void save()}>
              Lưu
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        <FieldRow label="Tên">
          <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} data-autofocus />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Loại">
            <Segmented
              block
              size="sm"
              value={d.kind}
              onChange={(k) => setD((x) => ({ ...x, kind: k, options: x.id ? x.options : JSON.stringify(DEFAULT_OPTIONS[k], null, 2) }))}
              options={(["IMAGE", "VIDEO", "ASSEMBLE"] as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
            />
          </FieldRow>
          <FieldRow label="Engine">
            <Select inputSize="sm" value={d.provider} onChange={(e) => set("provider", e.target.value as Provider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </FieldRow>
          <FieldRow label="Model của engine" hint="Codex trống = mặc định">
            <TextInput className="font-mono" value={d.engineModel} onChange={(e) => set("engineModel", e.target.value)} placeholder="muse-image" />
          </FieldRow>
          <FieldRow label="Gói tối thiểu">
            <Segmented block size="sm" value={d.minPlanRank} onChange={(v) => set("minPlanRank", v)} options={[0, 1, 2].map((r) => ({ value: r, label: PLAN_RANK_LABEL[r] }))} />
          </FieldRow>
          <FieldRow label="Giá gốc">
            <NumberInput value={d.baseCost} min={0} suffix="Credit" onChange={(v) => set("baseCost", v)} />
          </FieldRow>
          <FieldRow label="Thứ tự">
            <NumberInput value={d.sort} step="1" onChange={(v) => set("sort", v)} />
          </FieldRow>
        </div>

        {d.provider === "MUSE" && d.kind !== "ASSEMBLE" && (
          <FieldRow label="Tài khoản Muse" hint={accounts ? "Trống = tài khoản nào cũng được" : "Không tải được danh sách — nhập mã"}>
            {accounts ? (
              <Select inputSize="sm" value={d.museAccount} onChange={(e) => set("museAccount", e.target.value)}>
                <option value="">Mọi tài khoản</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {(a.label || a.id) + (a.enabled ? "" : " (tắt)") + (a.meta?.kinds?.length ? ` · ${a.meta.kinds.join("/")}` : "")}
                  </option>
                ))}
                {pinned && <option value={d.museAccount}>{d.museAccount} (không còn)</option>}
              </Select>
            ) : (
              <TextInput className="font-mono" value={d.museAccount} onChange={(e) => set("museAccount", e.target.value)} placeholder="acc_…" />
            )}
          </FieldRow>
        )}

        <Switch label="Đang bật" checked={d.enabled} onChange={(v) => set("enabled", v)} />

        <FieldRow
          label="Tham số (JSON)"
          hint={jsonError ? <span className="text-danger">{jsonError}</span> : '{"aspectRatios":["1:1","9:16"],"counts":[1,2,4],"durations":[5,10],"maxRefs":1}'}
        >
          <CodeArea rows={8} value={d.options} onChange={(e) => set("options", e.target.value)} className={cx(jsonError && "shadow-[inset_0_0_0_1px_rgba(255,92,108,.6)]")} />
        </FieldRow>
      </div>
      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title={`Xóa “${d.name}”?`}
        body="Model đã có tác vụ sẽ chỉ bị tắt."
        confirmLabel="Xóa"
        busy={isBusy("del")}
        onConfirm={() => void remove()}
      />
    </Drawer>
  );
}

export function ModelsView({ models: initial }: { models: Model[] }) {
  const [models, setModels] = useState(initial);
  useEffect(() => setModels(initial), [initial]);
  const [kind, setKind] = useState<"ALL" | Kind>("ALL");
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  const accounts = usePoll<{ data: MuseAccount[] }>("/api/admin/muse/accounts");
  const { run, isBusy } = useAction();
  const accName = (id: string) => accounts.data?.data.find((a) => a.id === id)?.label || id;

  const rows = models.filter((m) => kind === "ALL" || m.kind === kind);

  async function toggle(m: Model, enabled: boolean) {
    setModels((l) => l.map((x) => (x.id === m.id ? { ...x, enabled } : x)));
    const r = await run(m.id, () => api<Model>("/api/admin/models", jsonInit("PATCH", { id: m.id, enabled })), { success: enabled ? `Đã bật ${m.name}` : `Đã tắt ${m.name}` });
    if (!r) setModels((l) => l.map((x) => (x.id === m.id ? { ...x, enabled: !enabled } : x)));
  }

  const cols: Col<Model>[] = [
    {
      key: "name",
      label: "Model",
      mobile: "title",
      cell: (m) => (
        <span className={cx("flex min-w-0 items-center gap-2.5", !m.enabled && "opacity-55")}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-m1 bg-white/[.04] text-muted">
            <Icon name={KIND_ICON[m.kind]} size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium">{m.name}</span>
            <span className="block truncate text-xs text-muted">{optionSummary(m)}</span>
          </span>
        </span>
      ),
    },
    {
      key: "engine",
      label: "Engine",
      cell: (m) => (
        <span className="text-[13px]">
          {m.provider}
          {m.engineModel && <Mono className="ml-1.5 text-dim">{m.engineModel}</Mono>}
        </span>
      ),
    },
    {
      key: "acc",
      label: "Tài khoản",
      cell: (m) => {
        if (m.provider !== "MUSE") return <span className="text-dim">—</span>;
        const acc = museAccountOf(m);
        return acc ? <Badge tone="info">{accName(acc)}</Badge> : <span className="text-xs text-muted">Mọi</span>;
      },
    },
    { key: "plan", label: "Gói", cell: (m) => (m.minPlanRank > 0 ? <Badge tone="aura">{PLAN_RANK_LABEL[m.minPlanRank]}</Badge> : <span className="text-xs text-muted">Free</span>) },
    { key: "cost", label: "Giá", align: "right", cell: (m) => <span className="tabular-nums">{formatCredit(m.baseCost)}</span> },
    { key: "sort", label: "#", align: "right", cell: (m) => <span className="text-xs text-dim tabular-nums">{m.sort}</span> },
    {
      key: "on",
      label: "Bật",
      align: "right",
      mobile: "actions",
      cell: (m) => (
        <span className="ml-auto inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <span className="w-11">
            <Switch label={<span className="sr-only">Bật {m.name}</span>} checked={m.enabled} disabled={isBusy(m.id)} onChange={(v) => void toggle(m, v)} />
          </span>
        </span>
      ),
    },
  ];

  const counts = { ALL: models.length, IMAGE: 0, VIDEO: 0, ASSEMBLE: 0 } as Record<"ALL" | Kind, number>;
  for (const m of models) counts[m.kind]++;

  return (
    <>
      <PageHeader
        icon="cpu"
        title="Model"
        sub={`${models.filter((m) => m.enabled).length}/${models.length} đang bật`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
            Thêm
          </Button>
        }
      />
      <div className="mb-4">
        <Segmented
          size="sm"
          ariaLabel="Loại"
          value={kind}
          onChange={setKind}
          options={(["ALL", "IMAGE", "VIDEO", "ASSEMBLE"] as const).map((k) => ({ value: k, label: `${k === "ALL" ? "Tất cả" : KIND_LABEL[k]} ${counts[k]}` }))}
        />
      </div>
      <DataList rows={rows} cols={cols} rowKey={(m) => m.id} onRowClick={(m) => setEditing(m)} empty={<Empty icon="cpu" title="Chưa có model" className="py-12" />} />
      <ModelEditor
        open={editing !== null}
        model={editing && editing !== "new" ? editing : undefined}
        accounts={accounts.data?.data}
        onClose={() => setEditing(null)}
        onSaved={(m) => setModels((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l, m]))}
      />
    </>
  );
}
