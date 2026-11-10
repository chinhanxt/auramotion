"use client";

import type { AiModel } from "@prisma/client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Empty } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, Popover } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { VendorLogo } from "@/components/ui/VendorLogo";
import { ModelBadge } from "@/components/studio/ModelPicker";
import {
  ApiError,
  MODEL_BADGES,
  VENDOR_LABEL,
  VENDOR_ORDER,
  api,
  formatCredit,
  groupByVendor,
  isNotFound,
  isVideoUrl,
  modelLabel,
  vendorOf,
  type ModelCatalogFields,
  type ModelSyncResult,
  type ModelVerified,
  type ModelVerifyResult,
} from "@/lib/api-client";
import { useNow } from "../ai/bits";
import { codexModels, type AiData, type AiModel as LiveModel } from "../ai/types";
import { KIND_ICON, KIND_LABEL, PLAN_RANK_LABEL, formatMs, timeAgo } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { CodeArea, FieldRow, Mono, NumberInput, PageHeader, TextInput } from "../kit";
import type { Plain } from "../plain";

type Model = Omit<Plain<AiModel>, keyof ModelCatalogFields> & ModelCatalogFields;
type Kind = Model["kind"];
type Provider = Model["provider"];
type MuseAccount = { id: string; label: string; enabled: boolean; meta?: { kinds?: string[] } };
type Lists = Record<Provider, LiveModel[]>;

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: "MUSE", label: "Muse" },
  { value: "AGY", label: "agy" },
  { value: "CODEX", label: "Codex" },
  { value: "LOCAL", label: "Ghép (máy chủ)" },
];
const PROVIDER_SHORT: Record<Provider, string> = { MUSE: "Muse", AGY: "agy", CODEX: "Codex", LOCAL: "máy chủ" };

const DEFAULT_OPTIONS: Record<Kind, Record<string, unknown>> = {
  IMAGE: { aspectRatios: ["1:1", "9:16", "16:9"], counts: [1, 2, 4], maxRefs: 1 },
  VIDEO: { aspectRatios: ["9:16", "16:9"], durations: [5, 10], maxRefs: 1 },
  ASSEMBLE: { aspectRatios: ["9:16", "16:9", "1:1"] },
};

const MUSE_MODELS: LiveModel[] = [
  { id: "muse-image", name: "Muse Image" },
  { id: "muse-video", name: "Muse Video" },
];

// Danh sách model thật cho ô engineModel: agy (ACP), codex (hợp các profile, bỏ ẩn), muse.
function liveLists(ai?: AiData): Lists {
  const muse = ai?.providers?.muse?.models?.length ? ai.providers.muse.models : MUSE_MODELS;
  return { AGY: ai?.providers?.agy?.models ?? [], CODEX: codexModels(ai).filter((m) => !m.hidden), MUSE: muse, LOCAL: [] };
}

function museAccountOf(m: Pick<Model, "options">): string {
  const v = (m.options as { museAccount?: unknown } | null)?.museAccount;
  return typeof v === "string" ? v : "";
}

function optionSummary(m: Model): string {
  const o = (m.options ?? {}) as { aspectRatios?: string[]; counts?: number[]; durations?: number[] };
  return [o.aspectRatios?.join(" "), o.counts && `×${o.counts.join("/")}`, o.durations && `${o.durations.join("/")}s`].filter(Boolean).join(" · ");
}

const vendorName = (v: string) => VENDOR_LABEL[v] ?? (v === "other" ? "Khác" : v);
const canVerify = (m: Model) => m.kind !== "ASSEMBLE";

// PATCH theo hợp đồng `/api/admin/models/:id`; backend cũ chỉ có PATCH `/api/admin/models` (id trong body).
async function patchModel(id: string, body: Record<string, unknown>): Promise<Model> {
  try {
    return await api<Model>(`/api/admin/models/${encodeURIComponent(id)}`, jsonInit("PATCH", body));
  } catch (e) {
    if (isNotFound(e)) return api<Model>("/api/admin/models", jsonInit("PATCH", { id, ...body }));
    throw e;
  }
}

// ───────── Ô sửa tại chỗ ─────────

function InlineText({
  value,
  placeholder,
  onSave,
  className,
  label,
  maxLength = 120,
}: {
  value: string;
  placeholder: string;
  onSave: (v: string) => void;
  className?: string;
  label: string;
  maxLength?: number;
}) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    if (!edit) setV(value);
  }, [value, edit]);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEdit(false);
    if (v.trim() !== value.trim()) onSave(v.trim());
  };
  if (edit) {
    return (
      <input
        autoFocus
        aria-label={label}
        value={v}
        maxLength={maxLength}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            done.current = true;
            setV(value);
            setEdit(false);
          }
        }}
        className={cx("-mx-1.5 w-[calc(100%+12px)] rounded-[8px] bg-white/[.06] px-1.5 outline-none shadow-[inset_0_0_0_1px_rgba(212,255,58,.35)]", className)}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`Sửa ${label}`}
      onClick={() => {
        done.current = false;
        setEdit(true);
      }}
      className={cx("group/it -mx-1.5 flex max-w-full min-w-0 items-center gap-1 rounded-[8px] px-1.5 text-left hover:bg-white/[.05]", className)}
    >
      <span className={cx("truncate", !value && "text-dim italic")}>{value || placeholder}</span>
      <Icon name="edit" size={12} className="shrink-0 text-dim opacity-0 transition-opacity group-hover/it:opacity-100" />
    </button>
  );
}

function BadgePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Popover
      className="w-40"
      trigger={({ toggle, ref, ...aria }) => (
        <button ref={ref} type="button" onClick={toggle} {...aria} aria-label="Nhãn" className="press shrink-0 rounded-full">
          {value ? <ModelBadge label={value} /> : <span className="inline-flex h-[18px] items-center rounded-full px-1.5 text-[10.5px] font-medium text-dim shadow-[inset_0_0_0_1px_var(--color-line2)] hover:text-muted">+ nhãn</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="space-y-0.5">
          {["", ...MODEL_BADGES].map((b) => (
            <button
              key={b || "_"}
              type="button"
              onClick={() => (onChange(b), close())}
              className={cx("press flex w-full items-center justify-between rounded-[9px] px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[.06]", b === value && "bg-white/[.06]")}
            >
              {b ? <ModelBadge label={b} /> : <span className="text-muted">Không nhãn</span>}
              {b === value && <Icon name="check" size={14} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

function PriceInput({ value, onSave }: { value: string; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(Number(value)));
  useEffect(() => setV(String(Number(value))), [value]);
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return setV(String(Number(value)));
    if (n !== Number(value)) onSave(n);
  };
  return (
    <span className="relative block w-[88px]">
      <Icon name="coin" size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[#f5c84b]" />
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        aria-label="Giá Credit"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className="h-8 w-full rounded-[9px] bg-white/[.04] pr-2 pl-7 text-[13px] font-semibold tabular-nums outline-none hairline focus:bg-white/[.07]"
      />
    </span>
  );
}

const MINI_SELECT = "h-8 w-full cursor-pointer appearance-none rounded-[9px] bg-white/[.04] pr-7 pl-2.5 text-[12.5px] outline-none hairline focus:bg-white/[.07] disabled:opacity-50";

function MiniSelect({ value, onChange, children, label, className, disabled }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string; className?: string; disabled?: boolean }) {
  return (
    <span className={cx("relative block min-w-0", className)}>
      <select aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={MINI_SELECT}>
        {children}
      </select>
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted" />
    </span>
  );
}

// engineModel: chọn từ model thật; "nhập tay" cho chế độ nâng cao.
function EngineModelField({ provider, kind, value, lists, onSave, size = "mini" }: { provider: Provider; kind: Kind; value: string; lists: Lists; onSave: (v: string) => void; size?: "mini" | "md" }) {
  const options = useMemo(() => {
    const base = lists[provider] ?? [];
    return provider === "MUSE" ? base.filter((m) => (kind === "VIDEO" ? /video/i.test(m.id) : !/video/i.test(m.id)) || m.id === value) : base;
  }, [lists, provider, kind, value]);
  const known = options.some((m) => m.id === value);
  const [manual, setManual] = useState(false);
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (provider === "LOCAL") return <span className="text-xs text-dim">ffmpeg</span>;
  const toggle = (
    <IconButton
      icon={manual ? "list" : "edit"}
      label={manual ? "Chọn từ danh sách" : "Nhập tay"}
      size="sm"
      variant={manual ? "subtle" : "ghost"}
      className={size === "mini" ? "!h-8 !w-8" : undefined}
      onClick={() => setManual((x) => !x)}
    />
  );
  return (
    <span className="flex min-w-0 items-center gap-1">
      {manual || (options.length === 0 && value && !known) ? (
        <input
          aria-label="Model của engine"
          value={text}
          placeholder={provider === "CODEX" ? "trống = mặc định" : "id model"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() !== value && onSave(text.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          className={cx(size === "mini" ? "h-8 rounded-[9px] text-[12.5px]" : "h-9 rounded-m1 text-[13px]", "min-w-0 flex-1 bg-black/30 px-2.5 font-mono outline-none hairline")}
        />
      ) : (
        <MiniSelect label="Model của engine" value={value} onChange={onSave} className="flex-1 font-mono" disabled={options.length === 0 && !value}>
          {provider === "CODEX" && <option value="">Mặc định (config.toml)</option>}
          {provider !== "CODEX" && !value && <option value="">{options.length ? "Chọn model…" : "Đang tải danh sách…"}</option>}
          {options.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
          {value && !known && <option value={value}>{value} (ngoài danh sách)</option>}
        </MiniSelect>
      )}
      {toggle}
    </span>
  );
}

// ───────── Test vẽ ─────────

type Testing = Record<string, number>;

function Thumb({ url, className }: { url: string; className?: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cx("press reveal block shrink-0 overflow-hidden rounded-[10px] bg-black/40 hairline", className)} aria-label="Ảnh mẫu">
      {isVideoUrl(url) ? (
        <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" onMouseEnter={(e) => void e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => e.currentTarget.pause()} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      )}
    </a>
  );
}

function VerifyChip({ v }: { v?: ModelVerified | null }) {
  if (!v) return <Badge tone="neutral">Chưa test</Badge>;
  const when = v.testedAt ? timeAgo(v.testedAt) : "";
  return v.ok ? (
    <span title={when ? `Test ${when}` : undefined}>
      <Badge tone="ok">
        <Icon name="check" size={11} strokeWidth={2.4} />
        Đã test{v.ms ? ` · ${formatMs(v.ms)}` : ""}
      </Badge>
    </span>
  ) : (
    <span title={v.error ?? undefined}>
      <Badge tone="danger" dot>
        Lỗi{when ? ` · ${when}` : ""}
      </Badge>
    </span>
  );
}

function VerifyCell({ m, since, onTest }: { m: Model; since?: number; onTest: () => void }) {
  const now = useNow(1000, since !== undefined);
  const v = m.verified;
  if (!canVerify(m)) return <span className="text-xs text-dim">—</span>;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {since !== undefined ? (
        <span className="skel skel-aura h-11 w-11 shrink-0 rounded-[10px]" aria-hidden="true" />
      ) : v?.sampleUrl ? (
        <Thumb url={v.sampleUrl} className="h-11 w-11" />
      ) : (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white/[.03] text-dim shadow-[inset_0_0_0_1px_var(--color-line)]">
          <Icon name={KIND_ICON[m.kind]} size={16} />
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        {since !== undefined ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-[#c9bdff] tabular-nums">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#b7a6ff]" />
            Đang vẽ · {formatMs(Math.max(0, now - since))}
          </p>
        ) : (
          <VerifyChip v={v} />
        )}
        {since === undefined && v && !v.ok && v.error && <p className="truncate text-[11px] text-danger/80" title={v.error}>{v.error}</p>}
      </div>
      <Button size="sm" variant="outline" icon="play" disabled={since !== undefined} onClick={onTest} className="shrink-0">
        Test vẽ
      </Button>
    </div>
  );
}

// ───────── Một dòng model ─────────

const GRID = "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.25fr)_88px_86px_minmax(250px,1fr)_36px]";

function ModelRow({
  m,
  i,
  lists,
  accounts,
  testing,
  onPatch,
  onTest,
  onOpen,
  busy,
}: {
  m: Model;
  i: number;
  lists: Lists;
  accounts?: MuseAccount[];
  testing?: number;
  onPatch: (m: Model, body: Record<string, unknown>) => void;
  onTest: (m: Model) => void;
  onOpen: (m: Model) => void;
  busy: boolean;
}) {
  const acc = museAccountOf(m);
  const { museAccount: _drop, ...restOptions } = (m.options ?? {}) as Record<string, unknown>;
  void _drop;
  return (
    <li className={cx("reveal grid grid-cols-1 items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5", GRID)} style={{ "--i": i } as React.CSSProperties}>
      {/* Tên + nhãn + mô tả */}
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <span className="block w-11">
            <Switch label={<span className="sr-only">Bật {modelLabel(m)}</span>} checked={m.enabled} disabled={busy} onChange={(v) => onPatch(m, { enabled: v })} />
          </span>
        </span>
        <VendorLogo vendor={vendorOf(m)} size={34} className={cx("transition-[filter,opacity] duration-300", !m.enabled && "opacity-45 grayscale")} />
        <div className={cx("min-w-0 flex-1 transition-opacity duration-300", !m.enabled && "opacity-60")}>
          <div className="flex min-w-0 items-center gap-1.5">
            <InlineText value={m.displayName ?? ""} placeholder={m.name} label="tên hiển thị" onSave={(displayName) => onPatch(m, { displayName })} className="h-6 text-[14px] font-semibold" />
            <BadgePicker value={m.badge ?? ""} onChange={(badge) => onPatch(m, { badge })} />
          </div>
          <InlineText value={m.description ?? ""} placeholder="Thêm mô tả ngắn…" label="mô tả" maxLength={160} onSave={(description) => onPatch(m, { description })} className="h-5 text-[12px] text-muted" />
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-dim">
            <Icon name={KIND_ICON[m.kind]} size={11} />
            {KIND_LABEL[m.kind]}
            {optionSummary(m) && <span className="truncate">· {optionSummary(m)}</span>}
            {m.source === "synced" && <span className="rounded-[5px] bg-white/[.05] px-1 font-medium text-muted">đồng bộ</span>}
          </p>
        </div>
        <IconButton icon="more" label="Sửa đầy đủ" size="sm" className="self-start lg:hidden" onClick={() => onOpen(m)} />
      </div>

      {/* Engine: model thật + tài khoản Muse */}
      <div className="min-w-0 space-y-1.5 max-lg:pl-[102px] max-sm:pl-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="w-12 shrink-0 text-[11px] font-medium text-muted">{PROVIDER_SHORT[m.provider]}</span>
          <div className="min-w-0 flex-1">
            <EngineModelField provider={m.provider} kind={m.kind} value={m.engineModel} lists={lists} onSave={(engineModel) => onPatch(m, { engineModel })} />
          </div>
        </div>
        {m.provider === "MUSE" && m.kind !== "ASSEMBLE" && (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="w-12 shrink-0 text-[11px] font-medium text-muted">Tài khoản</span>
            <MiniSelect
              label="Tài khoản Muse"
              className="flex-1"
              value={acc}
              disabled={!accounts}
              onChange={(v) => onPatch(m, { options: { ...restOptions, ...(v ? { museAccount: v } : {}) } })}
            >
              <option value="">{accounts ? "Mọi tài khoản" : "Đang tải…"}</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.label || a.id) + (a.enabled ? "" : " (tắt)")}
                </option>
              ))}
              {acc && accounts && !accounts.some((a) => a.id === acc) && <option value={acc}>{acc} (không còn)</option>}
            </MiniSelect>
          </div>
        )}
      </div>

      {/* Giá + gói */}
      <div className="flex items-center gap-2 max-lg:pl-[102px] max-sm:pl-0 lg:contents">
        <PriceInput value={m.baseCost} onSave={(baseCost) => onPatch(m, { baseCost })} />
        <MiniSelect label="Gói tối thiểu" className="w-[86px]" value={String(m.minPlanRank)} onChange={(v) => onPatch(m, { minPlanRank: Number(v) })}>
          {[0, 1, 2].map((r) => (
            <option key={r} value={r}>
              {PLAN_RANK_LABEL[r]}
            </option>
          ))}
        </MiniSelect>
      </div>

      {/* Test vẽ */}
      <div className="min-w-0 max-lg:pl-[102px] max-sm:pl-0">
        <VerifyCell m={m} since={testing} onTest={() => onTest(m)} />
      </div>

      <div className="hidden justify-end lg:flex">
        <IconButton icon="more" label="Sửa đầy đủ" size="sm" onClick={() => onOpen(m)} />
      </div>
    </li>
  );
}

// ───────── Drawer sửa đầy đủ / thêm ─────────

type Draft = {
  id?: string;
  name: string;
  displayName: string;
  vendor: string;
  badge: string;
  description: string;
  etaSec: string;
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
    return {
      name: "",
      displayName: "",
      vendor: "",
      badge: "",
      description: "",
      etaSec: "",
      provider: "MUSE",
      engineModel: "",
      kind: "IMAGE",
      minPlanRank: 0,
      baseCost: "1",
      sort: "0",
      enabled: true,
      museAccount: "",
      options: JSON.stringify(DEFAULT_OPTIONS.IMAGE, null, 2),
    };
  }
  const { museAccount, ...rest } = (m.options ?? {}) as Record<string, unknown>;
  return {
    id: m.id,
    name: m.name,
    displayName: m.displayName ?? "",
    vendor: m.vendor ?? "",
    badge: m.badge ?? "",
    description: m.description ?? "",
    etaSec: m.etaSec ? String(m.etaSec) : "",
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

function ModelEditor({
  open,
  model,
  accounts,
  lists,
  onClose,
  onSaved,
}: {
  open: boolean;
  model?: Model;
  accounts?: MuseAccount[];
  lists: Lists;
  onClose: () => void;
  onSaved: (m: Model) => void;
}) {
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

  async function save() {
    if (jsonError) return void toast.error(`Tham số: ${jsonError}`);
    const options = { ...(JSON.parse(d.options) as Record<string, unknown>), ...(d.provider === "MUSE" && d.kind !== "ASSEMBLE" && d.museAccount ? { museAccount: d.museAccount } : {}) };
    const body = {
      name: d.name,
      displayName: d.displayName.trim(),
      vendor: d.vendor || vendorOf({ provider: d.provider, engineModel: d.engineModel, name: d.name }),
      badge: d.badge,
      description: d.description.trim(),
      etaSec: d.etaSec ? Number(d.etaSec) : null,
      provider: d.provider,
      engineModel: d.engineModel,
      kind: d.kind,
      minPlanRank: d.minPlanRank,
      baseCost: Number(d.baseCost),
      sort: Number(d.sort) || 0,
      enabled: d.enabled,
      options,
    };
    const r = await run("save", () => (d.id ? patchModel(d.id, body) : api<Model>("/api/admin/models", jsonInit("POST", body))), { success: d.id ? "Đã lưu" : "Đã thêm model" });
    if (r) {
      onSaved({ ...(model ?? {}), ...body, ...r } as Model);
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
      title={d.id ? d.displayName || d.name || "Model" : "Thêm model"}
      subtitle={d.id ? <Mono>{d.name}</Mono> : undefined}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Tên hiển thị" hint="Người dùng thấy tên này">
            <TextInput value={d.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder="Gemini 3.8 Flash" data-autofocus />
          </FieldRow>
          <FieldRow label="Khóa nội bộ" hint="Duy nhất, vd agy:gemini-3.8-flash:IMAGE">
            <TextInput className="font-mono" value={d.name} onChange={(e) => set("name", e.target.value)} />
          </FieldRow>
          <FieldRow label="Hãng">
            <Select inputSize="sm" value={d.vendor} onChange={(e) => set("vendor", e.target.value)}>
              <option value="">Tự nhận ({vendorName(vendorOf({ provider: d.provider, engineModel: d.engineModel, name: d.name }))})</option>
              {VENDOR_ORDER.map((v) => (
                <option key={v} value={v}>
                  {vendorName(v)}
                </option>
              ))}
            </Select>
          </FieldRow>
          <FieldRow label="Nhãn">
            <Segmented block size="sm" value={d.badge} onChange={(v) => set("badge", v)} options={["", ...MODEL_BADGES].map((b) => ({ value: b, label: b || "—" }))} />
          </FieldRow>
        </div>
        <FieldRow label="Mô tả ngắn">
          <TextInput value={d.description} maxLength={160} onChange={(e) => set("description", e.target.value)} placeholder="Ảnh sắc nét, hợp sản phẩm" />
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
        </div>
        <FieldRow label="Model của engine" hint={d.provider === "CODEX" ? "Mặc định = model trong config.toml" : "Danh sách thật từ /admin/ai"}>
          <EngineModelField provider={d.provider} kind={d.kind} value={d.engineModel} lists={lists} onSave={(v) => set("engineModel", v)} size="md" />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-3">
          <FieldRow label="Giá gốc">
            <NumberInput value={d.baseCost} min={0} suffix="Credit" onChange={(v) => set("baseCost", v)} />
          </FieldRow>
          <FieldRow label="Ước tính">
            <NumberInput value={d.etaSec} min={0} step="1" suffix="giây" onChange={(v) => set("etaSec", v)} />
          </FieldRow>
          <FieldRow label="Thứ tự">
            <NumberInput value={d.sort} step="1" onChange={(v) => set("sort", v)} />
          </FieldRow>
        </div>
        <FieldRow label="Gói tối thiểu">
          <Segmented block size="sm" value={d.minPlanRank} onChange={(v) => set("minPlanRank", v)} options={[0, 1, 2].map((r) => ({ value: r, label: PLAN_RANK_LABEL[r] }))} />
        </FieldRow>

        {d.provider === "MUSE" && d.kind !== "ASSEMBLE" && (
          <FieldRow label="Tài khoản Muse" hint="Trống = tài khoản nào cũng được">
            <Select inputSize="sm" value={d.museAccount} disabled={!accounts} onChange={(e) => set("museAccount", e.target.value)}>
              <option value="">{accounts ? "Mọi tài khoản" : "Đang tải…"}</option>
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {(a.label || a.id) + (a.enabled ? "" : " (tắt)") + (a.meta?.kinds?.length ? ` · ${a.meta.kinds.join("/")}` : "")}
                </option>
              ))}
              {d.museAccount && accounts && !accounts.some((a) => a.id === d.museAccount) && <option value={d.museAccount}>{d.museAccount} (không còn)</option>}
            </Select>
          </FieldRow>
        )}

        <Switch label="Đang bật" checked={d.enabled} onChange={(v) => set("enabled", v)} />

        <FieldRow
          label="Tham số (JSON)"
          hint={jsonError ? <span className="text-danger">{jsonError}</span> : '{"aspectRatios":["1:1","9:16"],"counts":[1,2,4],"durations":[5,10],"maxRefs":1}'}
        >
          <CodeArea rows={7} value={d.options} onChange={(e) => set("options", e.target.value)} className={cx(jsonError && "shadow-[inset_0_0_0_1px_rgba(255,92,108,.6)]")} />
        </FieldRow>
      </div>
      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        danger
        title={`Xóa “${d.displayName || d.name}”?`}
        body="Model đã có tác vụ sẽ chỉ bị tắt."
        confirmLabel="Xóa"
        busy={isBusy("del")}
        onConfirm={() => void remove()}
      />
    </Drawer>
  );
}

// ───────── Trang ─────────

export function ModelsView({ models: source }: { models: Plain<AiModel>[] }) {
  // Trường catalog v2 (vendor, displayName, verified…) có thể chưa có ở backend cũ.
  const initial = source as unknown as Model[];
  const [models, setModels] = useState(initial);
  useEffect(() => setModels(source as unknown as Model[]), [source]);
  const [kind, setKind] = useState<"ALL" | Kind>("ALL");
  const [editing, setEditing] = useState<Model | "new" | null>(null);
  const [testing, setTesting] = useState<Testing>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const stopBulk = useRef(false);
  const accounts = usePoll<{ data: MuseAccount[] }>("/api/admin/muse/accounts");
  const ai = usePoll<AiData>("/api/admin/ai");
  const lists = useMemo(() => liveLists(ai.data), [ai.data]);
  const { run, isBusy } = useAction();
  const toast = useToast();
  const router = useRouter();

  const rows = models.filter((m) => kind === "ALL" || m.kind === kind);
  const groups = useMemo(() => groupByVendor(rows), [rows]);
  const counts = { ALL: models.length, IMAGE: 0, VIDEO: 0, ASSEMBLE: 0 } as Record<"ALL" | Kind, number>;
  for (const m of models) counts[m.kind]++;

  async function onPatch(m: Model, body: Record<string, unknown>) {
    const optimistic = { ...m, ...body, ...(body.baseCost !== undefined ? { baseCost: String(body.baseCost) } : {}) } as Model;
    setModels((l) => l.map((x) => (x.id === m.id ? optimistic : x)));
    const label = "enabled" in body ? (body.enabled ? `Đã bật ${modelLabel(m)}` : `Đã tắt ${modelLabel(m)}`) : "Đã lưu";
    const r = await run(m.id, () => patchModel(m.id, body), { success: label });
    if (r) setModels((l) => l.map((x) => (x.id === m.id ? ({ ...optimistic, ...r } as Model) : x)));
    else setModels((l) => l.map((x) => (x.id === m.id ? m : x)));
  }

  async function verify(m: Model): Promise<boolean> {
    setTesting((t) => ({ ...t, [m.id]: Date.now() }));
    try {
      const r = await api<ModelVerifyResult>(`/api/admin/models/${encodeURIComponent(m.id)}/verify`, jsonInit("POST", {}));
      const verified: ModelVerified = { ok: r.ok, testedAt: r.testedAt ?? new Date().toISOString(), ms: r.ms ?? null, error: r.error ?? null, sampleUrl: r.sampleUrl ?? null };
      setModels((l) => l.map((x) => (x.id === m.id ? { ...x, verified } : x)));
      if (!r.ok) toast.error(`${modelLabel(m)}: lỗi`, { body: r.error ?? undefined });
      return true;
    } catch (e) {
      if (isNotFound(e)) {
        toast.error("Backend chưa có Test vẽ");
        return false;
      }
      const error = (e as Error).message;
      setModels((l) => l.map((x) => (x.id === m.id ? { ...x, verified: { ok: false, testedAt: new Date().toISOString(), error } } : x)));
      toast.error(`${modelLabel(m)}: lỗi`, { body: error });
      return !(e instanceof ApiError && e.status === 0);
    } finally {
      setTesting((t) => {
        const n = { ...t };
        delete n[m.id];
        return n;
      });
    }
  }

  // Test lần lượt từng model đang bật (1 job vẽ một lúc, không dồn tải).
  async function verifyAll() {
    if (bulk) {
      stopBulk.current = true;
      return;
    }
    const list = models.filter((m) => m.enabled && canVerify(m));
    if (!list.length) return void toast.info("Chưa có model nào đang bật");
    stopBulk.current = false;
    setBulk({ done: 0, total: list.length });
    let ok = 0;
    for (const [i, m] of list.entries()) {
      if (stopBulk.current) break;
      const cont = await verify(m);
      if (!cont) break;
      ok++;
      setBulk({ done: i + 1, total: list.length });
    }
    setBulk(null);
    if (ok) toast.success(`Đã test ${ok}/${list.length} model`);
  }

  async function sync() {
    const r = await run(
      "sync",
      async () => {
        try {
          return await api<ModelSyncResult>("/api/admin/models/sync", jsonInit("POST", {}));
        } catch (e) {
          if (isNotFound(e)) throw new Error("Backend chưa có đồng bộ model");
          throw e;
        }
      },
      { silent: true },
    );
    if (!r) return;
    toast.success(r.created > 0 ? `Thêm ${r.created} model` : "Không có model mới", { body: `${r.existing ?? 0} model đã có · model mới mặc định tắt` });
    if (r.created > 0) router.refresh();
  }

  const enabled = models.filter((m) => m.enabled).length;

  return (
    <>
      <PageHeader
        icon="cpu"
        title="Model"
        sub={
          <span className="inline-flex items-center gap-2">
            {enabled}/{models.length} đang bật
            {ai.error && !ai.data && <span className="text-warn">· chưa tải được danh sách model thật</span>}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={bulk ? "stop" : "play"} onClick={() => void verifyAll()}>
              {bulk ? `Đang test ${Math.min(bulk.done + 1, bulk.total)}/${bulk.total} · Dừng` : "Test các model đang bật"}
            </Button>
            <Button variant="outline" icon="refresh" loading={isBusy("sync")} onClick={() => void sync()}>
              Đồng bộ model
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setEditing("new")}>
              Thêm
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          size="sm"
          ariaLabel="Loại"
          value={kind}
          onChange={setKind}
          options={(["ALL", "IMAGE", "VIDEO", "ASSEMBLE"] as const).map((k) => ({ value: k, label: `${k === "ALL" ? "Tất cả" : KIND_LABEL[k]} ${counts[k]}` }))}
        />
        {bulk && (
          <span className="h-1 w-40 overflow-hidden rounded-full bg-white/[.07]" aria-hidden="true">
            <span className="block h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-out)]" style={{ width: `${(bulk.done / bulk.total) * 100}%` }} />
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-m3 bg-s1 hairline">
          <Empty icon="cpu" title="Chưa có model" hint="Bấm Đồng bộ model để lấy danh sách thật" className="py-12" />
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([vendor, list], gi) => {
            const on = list.filter((m) => m.enabled).length;
            return (
              <section key={vendor} className="reveal overflow-hidden rounded-m3 bg-s1 hairline" style={{ "--i": gi } as React.CSSProperties}>
                <header className="relative flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
                  <VendorLogo vendor={vendor} size={28} />
                  <h2 className="text-[15px] font-semibold">{vendorName(vendor)}</h2>
                  <span className="text-xs text-muted tabular-nums">
                    {on}/{list.length} bật
                  </span>
                </header>
                <div className={cx("hidden gap-x-4 px-5 pt-2.5 pb-0.5 text-[10.5px] font-semibold tracking-[0.06em] text-dim uppercase lg:grid", GRID)} aria-hidden="true">
                  <span className="pl-[102px]">Tên · nhãn · mô tả</span>
                  <span>Model engine</span>
                  <span>Giá</span>
                  <span>Gói</span>
                  <span>Test vẽ</span>
                  <span />
                </div>
                <ul className="divide-y divide-line">
                  {list.map((m, i) => (
                    <ModelRow
                      key={m.id}
                      m={m}
                      i={i}
                      lists={lists}
                      accounts={accounts.data?.data}
                      testing={testing[m.id]}
                      onPatch={(x, b) => void onPatch(x, b)}
                      onTest={(x) => void verify(x)}
                      onOpen={setEditing}
                      busy={isBusy(m.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      <ModelEditor
        open={editing !== null}
        model={editing && editing !== "new" ? editing : undefined}
        accounts={accounts.data?.data}
        lists={lists}
        onClose={() => setEditing(null)}
        onSaved={(m) => setModels((l) => (l.some((x) => x.id === m.id) ? l.map((x) => (x.id === m.id ? m : x)) : [...l, m]))}
      />
    </>
  );
}
