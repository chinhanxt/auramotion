"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Empty, Notice, Skeleton } from "@/components/ui/Bits";
import { Button, IconButton } from "@/components/ui/Button";
import { Stepper, Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, MenuItem, Modal, Popover } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api-client";
import { formatDateTime, timeAgo } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { CodeArea, DataList, FieldRow, Mono, NumberInput, PageHeader, Panel, SaveBar, Stat, TextInput, type Col } from "../kit";
import { LiveDot, SLOT_LABEL, SlotMeters, type MuseSlots, type SlotType } from "./live";

// ───────── Kiểu dữ liệu muse2api ─────────

type Quota = { plan?: string; weekly_used_pct?: number; resets_at?: string; extra_left?: string; found?: boolean; checked_at?: number };
type Account = {
  id: string;
  label: string;
  enabled: boolean;
  status: string;
  cookie_expires?: Record<string, number>;
  created_at?: number;
  last_used_at?: number | null;
  cooldown_until?: number;
  last_error?: string | null;
  success_count?: number;
  fail_count?: number;
  meta?: { kinds?: SlotType[]; quota?: Quota; renewed_at?: number; vm_state?: string; kind_blocked_until?: Record<string, number> };
};
type Task = { id: string; kind?: string; status?: string; progress?: number; created_at?: number; request?: { prompt?: string; model?: string } };
type Status = {
  status: {
    version?: string;
    driver?: { driver?: string; ok?: boolean; tabs?: number; busy_tabs?: number };
    accounts?: { total?: number; available?: number; invalid?: number; inflight?: number };
    error?: string;
  };
  ready: { ready?: boolean; error?: string };
  tasks: Task[];
  videoBlocked: { at: string; message: string } | null;
  slots: Record<SlotType, number>;
};

const KINDS: SlotType[] = ["image", "video", "chat"];
const SESSION_COOKIES = ["hatch_sess", "hatch_native_auth_device"];

// Hạn phiên = cookie phiên hết hạn sớm nhất (giây epoch).
function sessionExpiry(a: Account): number | null {
  const exp = a.cookie_expires ?? {};
  const vals = SESSION_COOKIES.map((k) => exp[k]).filter((v): v is number => typeof v === "number" && v > 0);
  return vals.length ? Math.min(...vals) * 1000 : null;
}

function statusTone(a: Account): { tone: "ok" | "warn" | "danger" | "neutral"; label: string } {
  if (!a.enabled) return { tone: "neutral", label: "Tắt" };
  if (a.status === "active" && (a.cooldown_until ?? 0) * 1000 > Date.now()) return { tone: "warn", label: "Nghỉ" };
  if (a.status === "active") return { tone: "ok", label: "Hoạt động" };
  if (a.status === "cooldown") return { tone: "warn", label: "Nghỉ" };
  return { tone: "danger", label: a.status === "invalid" ? "Hỏng phiên" : a.status };
}

// Nhận dạng định dạng cookie dán vào: JSON (EditThisCookie / dict) hay chuỗi "Cookie:".
function parseCookies(raw: string): { value: unknown; kind: "json-list" | "json-dict" | "header" | null } {
  const t = raw.trim();
  if (!t) return { value: null, kind: null };
  try {
    const v = JSON.parse(t) as unknown;
    if (Array.isArray(v)) return { value: v, kind: "json-list" };
    if (v && typeof v === "object") return { value: v, kind: "json-dict" };
  } catch {
    // không phải JSON
  }
  return { value: t.replace(/^cookie:\s*/i, ""), kind: "header" };
}

const COOKIE_KIND_LABEL = { "json-list": "JSON (EditThisCookie)", "json-dict": "JSON", header: "Chuỗi Cookie" } as const;

// ───────── Quota (tải lười) ─────────

function QuotaCell({ account }: { account: Account }) {
  const [q, setQ] = useState<Quota | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function load(refresh: boolean) {
    setBusy(true);
    try {
      const r = await api<{ quota?: Quota }>(`/api/admin/muse/accounts/${encodeURIComponent(account.id)}/quota${refresh ? "?refresh=1" : ""}`);
      setQ(r.quota ?? null);
      if (refresh) toast.success("Đã cập nhật quota");
    } catch (err) {
      setQ((prev) => prev ?? account.meta?.quota ?? null);
      if (refresh) toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  if (q === undefined) return <Skeleton className="h-8 w-36" />;
  if (!q || q.found === false) return <span className="text-xs text-dim">—</span>;
  const pct = Math.round(q.weekly_used_pct ?? 0);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="w-28 min-w-0">
        <span className="mb-1 flex justify-between text-[11px]">
          <span className="truncate text-muted">{q.plan ?? "—"}</span>
          <span className={cx("font-semibold tabular-nums", pct >= 85 ? "text-danger" : pct >= 60 ? "text-warn" : "text-fg")}>{pct}%</span>
        </span>
        <span className="block h-1 overflow-hidden rounded-full bg-white/[.07]">
          <span className={cx("block h-full rounded-full", pct >= 85 ? "bg-danger" : pct >= 60 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.max(2, pct)}%` }} />
        </span>
        <span className="mt-1 block truncate text-[10.5px] text-dim">{q.resets_at ? `reset ${q.resets_at}` : (q.extra_left ?? "")}</span>
      </span>
      <IconButton icon="refresh" label="Lấy lại quota" size="sm" loading={busy} onClick={() => void load(true)} />
    </span>
  );
}

// ───────── Loại việc ─────────

function KindToggles({ account, onChange, busy }: { account: Account; onChange: (kinds: SlotType[]) => void; busy: boolean }) {
  const raw = account.meta?.kinds ?? [];
  const all = raw.length === 0;
  const on = new Set<SlotType>(all ? KINDS : raw);
  function toggle(k: SlotType) {
    const next = new Set(on);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(KINDS.filter((x) => next.has(x)));
  }
  return (
    <span className={cx("inline-flex items-center gap-1", busy && "opacity-60")} role="group" aria-label="Loại việc">
      {KINDS.map((k) => {
        const active = on.has(k);
        return (
          <button
            key={k}
            type="button"
            disabled={busy}
            aria-pressed={active}
            title={SLOT_LABEL[k].label}
            onClick={() => toggle(k)}
            className={cx(
              "press inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium",
              active ? (all ? "bg-white/[.12] text-fg" : "bg-accent text-accent-ink") : "bg-white/[.03] text-dim shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-fg",
            )}
          >
            <Icon name={SLOT_LABEL[k].icon} size={13} />
            {SLOT_LABEL[k].label}
          </button>
        );
      })}
    </span>
  );
}

// ───────── Nhập cookie ─────────

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [raw, setRaw] = useState("");
  const { run, isBusy } = useAction();
  const parsed = useMemo(() => parseCookies(raw), [raw]);
  useEffect(() => {
    if (open) {
      setLabel("");
      setRaw("");
    }
  }, [open]);

  async function submit() {
    if (!parsed.kind) return;
    const res = await run(
      "import",
      () => api<{ account?: Account; missing_cookies?: string[] }>("/api/admin/muse/accounts", jsonInit("POST", { label: label.trim(), cookies: parsed.value })),
      { loading: "Đang nhập cookie…", success: "Đã thêm tài khoản" },
    );
    if (!res) return;
    if (res.missing_cookies?.length) setTimeout(() => alertMissing(res.missing_cookies!), 0);
    onDone();
    onClose();
  }
  const toast = useToast();
  function alertMissing(names: string[]) {
    toast.info("Thiếu cookie phiên", { body: names.join(", ") });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nhập cookie Muse"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted">{parsed.kind ? COOKIE_KIND_LABEL[parsed.kind] : "Dán JSON hoặc chuỗi Cookie"}</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Hủy
            </Button>
            <Button variant="primary" size="sm" icon="upload" disabled={!parsed.kind} loading={isBusy("import")} onClick={() => void submit()}>
              Nhập
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <FieldRow label="Tên">
          <TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Muse ảnh 2" data-autofocus />
        </FieldRow>
        <FieldRow label="Cookie" hint="EditThisCookie → Export, hoặc header Cookie từ DevTools.">
          <CodeArea rows={10} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'[{"name":"hatch_sess","value":"…"}]  hoặc  hatch_sess=…; hatch_native_auth_device=…'} />
        </FieldRow>
      </div>
    </Modal>
  );
}

// ───────── Slot ─────────

function SlotsEditor({ initial, used }: { initial: MuseSlots; used?: Record<SlotType, number> }) {
  const [saved, setSaved] = useState(initial);
  const [d, setD] = useState(initial);
  const { run, isBusy } = useAction();
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);
  async function save() {
    const r = await run("slots", () => api<{ muse_slots: MuseSlots }>("/api/admin/settings", jsonInit("PATCH", { muse_slots: d })), { success: "Đã lưu slot" });
    if (r) setSaved(r.muse_slots ?? d);
  }
  return (
    <Panel title="Slot" icon="sliders" actions={<SaveBar dirty={dirty} busy={isBusy("slots")} onSave={() => void save()} onReset={() => setD(saved)} />}>
      <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
        <SlotMeters used={used} limits={saved} />
        <div className="space-y-3">
          {KINDS.map((k) => (
            <div key={k} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm">
                <Icon name={SLOT_LABEL[k].icon} size={16} className="text-muted" />
                {SLOT_LABEL[k].label}
              </span>
              <Stepper ariaLabel={SLOT_LABEL[k].label} value={d[k]} min={0} max={k === "chat" ? 5 : 10} onChange={(v) => setD((x) => ({ ...x, [k]: v }))} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-sm">
              <Icon name="clock" size={16} className="text-muted" />
              Giãn cách video
            </span>
            <NumberInput className="w-28" value={d.gapSec} min={0} max={600} suffix="giây" onChange={(v) => setD((x) => ({ ...x, gapSec: Number(v) }))} />
          </div>
          <Switch label="Gửi tỷ lệ khung khi tạo video" checked={d.sendVideoAspect} onChange={(v) => setD((x) => ({ ...x, sendVideoAspect: v }))} />
        </div>
      </div>
    </Panel>
  );
}

// ───────── Trang ─────────

export function MuseView({ slots }: { slots: MuseSlots }) {
  const accounts = usePoll<{ data: Account[] }>("/api/admin/muse/accounts", 20_000);
  const status = usePoll<Status>("/api/admin/muse/status", 5000);
  const { run, isBusy } = useAction();
  const [importing, setImporting] = useState(false);
  const [rename, setRename] = useState<Account | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [confirm, setConfirm] = useState<{ kind: "renew" | "delete"; account: Account } | null>(null);

  const rows = accounts.data?.data ?? [];
  const s = status.data;

  function patchLocal(id: string, patch: (a: Account) => Account) {
    accounts.setData((d) => d && { data: d.data.map((a) => (a.id === id ? patch(a) : a)) });
  }

  async function patch(a: Account, body: { enabled?: boolean; label?: string; kinds?: SlotType[] }, msg: string) {
    const before = a;
    patchLocal(a.id, (x) => ({ ...x, ...("enabled" in body ? { enabled: body.enabled! } : {}), ...("label" in body ? { label: body.label! } : {}), ...(body.kinds ? { meta: { ...x.meta, kinds: body.kinds } } : {}) }));
    const r = await run(`p:${a.id}`, () => api(`/api/admin/muse/accounts/${encodeURIComponent(a.id)}`, jsonInit("PATCH", body)), { success: msg });
    if (!r) patchLocal(a.id, () => before);
  }

  function setKinds(a: Account, kinds: SlotType[]) {
    if (kinds.length === 0) return void run("k", async () => Promise.reject(new Error("Cần ít nhất 1 loại việc")));
    // Đủ 3 loại = mọi loại → gửi [].
    void patch(a, { kinds: kinds.length === KINDS.length ? [] : kinds }, "Đã đổi loại việc");
  }

  async function doConfirm() {
    if (!confirm) return;
    const { kind, account: a } = confirm;
    const ok =
      kind === "renew"
        ? await run(`r:${a.id}`, () => api(`/api/admin/muse/accounts/${encodeURIComponent(a.id)}/renew`, jsonInit("POST")), { loading: "Đang làm mới phiên…", success: "Đã làm mới phiên" })
        : await run(`d:${a.id}`, () => api(`/api/admin/muse/accounts/${encodeURIComponent(a.id)}`, jsonInit("DELETE")), { success: "Đã xóa tài khoản" });
    setConfirm(null);
    if (ok !== undefined) void accounts.refresh();
  }

  const cols: Col<Account>[] = [
    {
      key: "label",
      label: "Tài khoản",
      mobile: "title",
      cell: (a) => {
        const st = statusTone(a);
        return (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className={cx("h-2 w-2 shrink-0 rounded-full", { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-dim" }[st.tone])} />
            <span className="min-w-0">
              <span className="block truncate font-medium">{a.label || a.id}</span>
              <Mono className="block truncate text-[11px] text-dim">{a.id}</Mono>
            </span>
          </span>
        );
      },
    },
    {
      key: "status",
      label: "Trạng thái",
      cell: (a) => {
        const st = statusTone(a);
        return <Badge tone={st.tone}>{st.label}</Badge>;
      },
    },
    {
      key: "enabled",
      label: "Bật",
      cell: (a) => (
        <span className="inline-block w-12" onClick={(e) => e.stopPropagation()}>
          <Switch label={<span className="sr-only">Bật</span>} checked={a.enabled} disabled={isBusy(`p:${a.id}`)} onChange={(v) => void patch(a, { enabled: v }, v ? "Đã bật" : "Đã tắt")} />
        </span>
      ),
    },
    { key: "kinds", label: "Loại việc", cell: (a) => <KindToggles account={a} busy={isBusy(`p:${a.id}`)} onChange={(k) => setKinds(a, k)} /> },
    {
      key: "expiry",
      label: "Phiên",
      cell: (a) => {
        const exp = sessionExpiry(a);
        if (!exp) return <span className="text-xs text-dim">—</span>;
        const days = (exp - Date.now()) / 86_400_000;
        return (
          <span className={cx("text-[13px] tabular-nums", days < 0 ? "text-danger" : days < 3 ? "text-warn" : "text-fg/85")} title={formatDateTime(exp)}>
            {days < 0 ? "Hết hạn" : timeAgo(exp)}
          </span>
        );
      },
    },
    { key: "quota", label: "Quota", cell: (a) => <QuotaCell account={a} /> },
    {
      key: "count",
      label: "OK / Lỗi",
      align: "right",
      cell: (a) => (
        <span className="text-[13px] tabular-nums">
          <span className="text-ok">{a.success_count ?? 0}</span>
          <span className="text-dim"> / </span>
          <span className={(a.fail_count ?? 0) > 0 ? "text-danger" : "text-dim"}>{a.fail_count ?? 0}</span>
        </span>
      ),
    },
    {
      key: "error",
      label: "Lỗi cuối",
      mobile: "full",
      cell: (a) =>
        a.last_error ? (
          <span className="line-clamp-2 max-w-64 text-xs text-danger/90" title={a.last_error}>
            {a.last_error}
          </span>
        ) : (
          <span className="text-xs text-dim">{a.last_used_at ? `dùng ${timeAgo(a.last_used_at * 1000)}` : "—"}</span>
        ),
    },
    {
      key: "actions",
      label: "",
      align: "right",
      mobile: "actions",
      cell: (a) => (
        <Popover
          align="end"
          trigger={({ toggle, ref, ...aria }) => (
            <IconButton ref={ref} icon="more" label="Thao tác" size="sm" tip={false} onClick={toggle} {...aria} />
          )}
        >
          {(close) => (
            <div onClick={close}>
              <MenuItem
                icon={<Icon name="edit" size={16} />}
                onClick={() => {
                  setNewLabel(a.label);
                  setRename(a);
                }}
              >
                Đổi tên
              </MenuItem>
              <MenuItem icon={<Icon name="refresh" size={16} />} onClick={() => setConfirm({ kind: "renew", account: a })}>
                Làm mới phiên
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem danger icon={<Icon name="trash" size={16} />} onClick={() => setConfirm({ kind: "delete", account: a })}>
                Xóa
              </MenuItem>
            </div>
          )}
        </Popover>
      ),
    },
  ];

  const acc = s?.status.accounts;
  const drv = s?.status.driver;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="bolt"
        title="Muse"
        sub={
          <span className="inline-flex items-center gap-3">
            {s?.status.version && <span>muse2api {s.status.version}</span>}
            <LiveDot at={status.at} />
          </span>
        }
        actions={
          <>
            <IconButton
              icon="refresh"
              label="Tải lại"
              variant="outline"
              size="md"
              onClick={() => {
                void accounts.refresh();
                void status.refresh();
              }}
            />
            <Button variant="primary" icon="plus" onClick={() => setImporting(true)}>
              Nhập cookie
            </Button>
          </>
        }
      />

      {s?.videoBlocked && (
        <Notice tone="danger" icon="alert" className="items-center">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <b className="font-semibold">Video đang bị chặn</b> · {timeAgo(s.videoBlocked.at)}
              <span className="block text-xs text-muted">{s.videoBlocked.message}</span>
            </span>
            <Button
              size="sm"
              variant="danger"
              loading={isBusy("unblock")}
              onClick={async () => {
                const r = await run("unblock", () => api("/api/admin/muse/video-block/clear", jsonInit("POST")), { success: "Đã gỡ chặn video" });
                if (r) void status.refresh();
              }}
            >
              Gỡ chặn
            </Button>
          </div>
        </Notice>
      )}
      {status.error && !s && <Notice tone="danger">{status.error}</Notice>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          i={0}
          icon="pulse"
          label="muse2api"
          value={s ? (s.ready.ready ? "Sẵn sàng" : "Lỗi") : "…"}
          tone={s ? (s.ready.ready ? "ok" : "danger") : undefined}
          hint={drv ? `${drv.driver ?? "?"}${drv.ok === false ? " · driver lỗi" : ""}` : (s?.ready.error ?? "")}
        />
        <Stat i={1} icon="users" label="Tài khoản" value={acc ? `${acc.available ?? 0}/${acc.total ?? 0}` : "…"} hint={acc?.invalid ? `${acc.invalid} hỏng` : "khả dụng"} tone={acc?.invalid ? "warn" : undefined} />
        <Stat i={2} icon="frame" label="Tab" value={drv ? `${drv.busy_tabs ?? 0}/${drv.tabs ?? 0}` : "…"} hint="đang dùng" />
        <Stat i={3} icon="layers" label="Task" value={s ? s.tasks.length : "…"} hint={acc ? `${acc.inflight ?? 0} đang gửi` : ""} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="t-label text-[10px]">Tài khoản</p>
          <span className="text-xs text-dim">{rows.length || ""}</span>
        </div>
        {accounts.loading && !accounts.data ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-m2" />
            ))}
          </div>
        ) : accounts.error && !accounts.data ? (
          <Notice tone="danger">{accounts.error}</Notice>
        ) : (
          <DataList
            rows={rows}
            cols={cols}
            rowKey={(a) => a.id}
            empty={<Empty icon="bolt" title="Chưa có tài khoản" action={<Button size="sm" variant="primary" icon="plus" onClick={() => setImporting(true)}>Nhập cookie</Button>} />}
          />
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <SlotsEditor initial={slots} used={s?.slots} />
        <Panel title="Task đang chạy" icon="layers" pad={false}>
          {!s ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : s.tasks.length === 0 ? (
            <Empty icon="check" title="Rảnh" className="py-10" />
          ) : (
            <ul className="divide-y divide-line">
              {s.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <Icon name={t.kind === "video" ? "video" : t.kind === "image" ? "image" : "text"} size={16} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{t.request?.prompt ?? t.id}</span>
                    <span className="mt-1.5 block">
                      <span className="block h-1 overflow-hidden rounded-full bg-white/[.07]">
                        <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.max(3, t.progress ?? 0)}%`, background: "var(--aura)" }} />
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-muted tabular-nums">
                    {t.progress ?? 0}%
                    <span className="block text-dim">{t.created_at ? timeAgo(t.created_at * 1000) : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <ImportModal open={importing} onClose={() => setImporting(false)} onDone={() => void accounts.refresh()} />

      <Modal
        open={Boolean(rename)}
        onClose={() => setRename(null)}
        size="sm"
        title="Đổi tên"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRename(null)}>
              Hủy
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!newLabel.trim() || newLabel.trim() === rename?.label}
              onClick={() => {
                if (rename) void patch(rename, { label: newLabel.trim() }, "Đã đổi tên");
                setRename(null);
              }}
            >
              Lưu
            </Button>
          </div>
        }
      >
        <TextInput data-autofocus value={newLabel} onChange={(e) => setNewLabel(e.target.value)} maxLength={100} />
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        danger={confirm?.kind === "delete"}
        title={confirm?.kind === "delete" ? "Xóa tài khoản?" : "Làm mới phiên?"}
        body={confirm ? `${confirm.account.label || confirm.account.id}` : undefined}
        confirmLabel={confirm?.kind === "delete" ? "Xóa" : "Làm mới"}
        busy={confirm ? isBusy(`r:${confirm.account.id}`) || isBusy(`d:${confirm.account.id}`) : false}
        onConfirm={() => void doConfirm()}
      />
    </div>
  );
}
