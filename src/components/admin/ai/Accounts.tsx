"use client";

import { useEffect, useRef, useState } from "react";
import { Avatar, Badge, Empty } from "@/components/ui/Bits";
import { Button, IconButton, Spinner } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Textarea } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog, Modal } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { jsonInit, useAction } from "../hooks";
import { Panel, TextInput } from "../kit";
import { Countdown } from "./bits";
import { VendorLogo } from "@/components/ui/VendorLogo";
import type { CodexQuota, QuotaRemain, QuotaWindow } from "@/lib/api-client";
import { timeAgo } from "../format";
import { toTime, type AgyAccount, type AgyInfo, type CodexInfo } from "./types";

export type Call = <T>(url: string, init?: RequestInit) => Promise<T>;

// ───────── agy: tài khoản Google + proxy xoay ─────────

function quotaTone(pct: number) {
  return pct <= 15 ? "bg-danger" : pct <= 40 ? "bg-warn" : "bg-accent";
}

// Mốc reset: ISO, ms hoặc giây unix (codex `resets_at`).
function toMs(v: string | number | null | undefined): number | null {
  if (typeof v === "number" && v > 0 && v < 1e12) return v * 1000;
  return toTime(v);
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// Một thanh quota: % còn lại + đếm ngược reset.
function WindowBar({ label, pct, resetAt }: { label: string; pct: number | null; resetAt?: number | null }) {
  const known = pct !== null;
  const p = known ? clampPct(pct) : 0;
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
        <span className="truncate text-muted">{label}</span>
        <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
          {known ? <b className={cx("font-semibold", p <= 15 ? "text-danger" : "text-fg/90")}>{p}%</b> : <span className="text-dim">—</span>}
          {resetAt && (!known || p < 100) && (
            <span className="text-dim">
              <Countdown until={resetAt} prefix="↻ " />
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]">
        <div className={cx("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out)]", quotaTone(p))} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

type Win = { pct: number | null; resetAt: number | null };
type GroupView = { fiveHour: Win; weekly: Win };
const EMPTY_WIN: Win = { pct: null, resetAt: null };

function remainOf(v: number | QuotaRemain | null | undefined, reset?: string | number | null): Win {
  if (v === null || v === undefined) return { pct: null, resetAt: toMs(reset) };
  if (typeof v === "number") return { pct: v, resetAt: toMs(reset) };
  const pct = v.remainingPercent ?? v.pct ?? (typeof v.usedPercent === "number" ? 100 - v.usedPercent : null);
  return { pct: typeof pct === "number" ? pct : null, resetAt: toMs(v.resetAt ?? v.resetsAt ?? reset) };
}

// Gemini | Claude, mỗi nhóm 5 giờ + tuần: `groups` nếu backend có, không thì suy từ `quota[]` theo tiền tố nhóm.
export function agyGroups(a: AgyAccount): Record<"gemini" | "claude", GroupView | null> {
  const out: Record<"gemini" | "claude", GroupView | null> = { gemini: null, claude: null };
  for (const k of ["gemini", "claude"] as const) {
    const g = a.groups?.[k];
    if (g) {
      out[k] = { fiveHour: remainOf(g.fiveHour, g.fiveHourResetAt ?? g.resetAt), weekly: remainOf(g.weekly, g.weeklyResetAt) };
      continue;
    }
    const list = (a.quota ?? []).filter((q) => q.group.toLowerCase().replace(/[\s-]+/g, "_").startsWith(k));
    if (!list.length) continue;
    const pick = (weekly: boolean): Win => {
      const hits = list.filter((q) => /week|tuần|7d|weekly/i.test(q.group) === weekly);
      if (!hits.length) return EMPTY_WIN;
      const low = hits.reduce((x, y) => (y.pct < x.pct ? y : x));
      return { pct: low.pct, resetAt: toMs(low.resetAt) };
    };
    out[k] = { fiveHour: pick(false), weekly: pick(true) };
  }
  return out;
}

function GroupCol({ vendor, title, g }: { vendor: string; title: string; g: GroupView | null }) {
  return (
    <div className="min-w-0 rounded-m1 bg-white/[.025] p-2.5 shadow-[inset_0_0_0_1px_var(--color-line)]">
      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
        <VendorLogo vendor={vendor} size={16} />
        {title}
        {!g && <span className="ml-auto text-[11px] font-normal text-dim">chưa có số</span>}
      </p>
      <div className="space-y-2">
        <WindowBar label="5 giờ" pct={g?.fiveHour.pct ?? null} resetAt={g?.fiveHour.resetAt} />
        <WindowBar label="Tuần" pct={g?.weekly.pct ?? null} resetAt={g?.weekly.resetAt} />
      </div>
    </div>
  );
}

function windowLabel(w: QuotaWindow | null | undefined, fallback: string): string {
  const m = w?.windowMinutes;
  if (!m) return fallback;
  if (m >= 10080 - 60 && m <= 10080 + 60) return "Tuần";
  if (m % 1440 === 0) return `${m / 1440} ngày`;
  if (m % 60 === 0) return `${m / 60} giờ`;
  return `${m} phút`;
}

function codexWin(w?: QuotaWindow | null): Win {
  if (!w) return EMPTY_WIN;
  return { pct: typeof w.usedPercent === "number" ? 100 - w.usedPercent : null, resetAt: toMs(w.resetsAt) };
}

const SOURCE_LABEL: Record<string, string> = { "app-server": "app-server", "session-log": "log phiên" };

function CodexQuotaBars({ q }: { q?: CodexQuota | null }) {
  if (!q || (!q.primary && !q.secondary)) return <p className="text-[11.5px] text-dim">Chưa có số quota</p>;
  const a = codexWin(q.primary);
  const b = codexWin(q.secondary);
  return (
    <div className="space-y-2">
      <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        <WindowBar label={windowLabel(q.primary, "5 giờ")} pct={a.pct} resetAt={a.resetAt} />
        <WindowBar label={windowLabel(q.secondary, "Tuần")} pct={b.pct} resetAt={b.resetAt} />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] text-dim">
        {q.source && <span className="rounded-[5px] bg-white/[.05] px-1.5 py-px font-mono text-[10.5px] text-muted">{SOURCE_LABEL[q.source] ?? q.source}</span>}
        {q.checkedAt && <span suppressHydrationWarning>cập nhật {timeAgo(toMs(q.checkedAt) ?? q.checkedAt)}</span>}
      </p>
    </div>
  );
}

export function AgyAccounts({ agy, call, refresh, loading }: { agy?: AgyInfo; call: Call; refresh: () => void; loading?: boolean }) {
  const { run, isBusy } = useAction();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<AgyAccount | null>(null);
  const accounts = agy?.accounts ?? [];
  const proxy = agy?.proxy;

  const act = async (key: string, url: string, init: RequestInit, success: string) => {
    const r = await run(key, () => call(url, init), { success });
    if (r !== undefined) refresh();
    return r;
  };

  return (
    <Panel
      title="Tài khoản Google"
      icon="users"
      pad={false}
      actions={
        <>
          <Button size="sm" variant="ghost" icon="bolt" loading={isBusy("auto")} disabled={accounts.length < 2} onClick={() => void act("auto", "/api/admin/ai/agy/switch", jsonInit("POST", { auto: true }), "Đã chọn tài khoản nhiều quota nhất")}>
            Tự chọn
          </Button>
          <Button size="sm" variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Thêm
          </Button>
        </>
      }
    >
      <div className="border-b border-line px-4 py-2.5 sm:px-5">
        <Switch
          icon="refresh"
          checked={Boolean(proxy?.enabled)}
          disabled={isBusy("proxy") || !agy}
          onChange={(v) => void act("proxy", "/api/admin/ai/agy/proxy", jsonInit("POST", { enabled: v }), v ? "Đã bật proxy xoay" : "Đã tắt proxy xoay")}
          label={
            <span className="flex items-center gap-2">
              Proxy xoay tài khoản
              {proxy?.enabled && (
                <Badge tone={proxy.running ? "ok" : "warn"} dot>
                  {proxy.running ? `:${proxy.port ?? 8901}` : "Chưa chạy"}
                </Badge>
              )}
            </span>
          }
          hint="Hết quota → tự đổi sang tài khoản khác, không rơi xuống OpenAI"
        />
      </div>
      {accounts.length === 0 ? (
        <Empty icon="user" title={loading ? "Đang tải…" : "Chưa có tài khoản"} className="py-10" />
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((a, i) => (
            <li key={a.id} className={cx("reveal px-4 py-3.5 sm:px-5", a.active && "bg-accent/[.03]")} style={{ "--i": i } as React.CSSProperties}>
              <div className="flex items-center gap-3">
                <Avatar name={a.email} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{a.email}</span>
                    {a.active && (
                      <Badge tone="accent" className="!h-5">
                        Đang dùng
                      </Badge>
                    )}
                  </p>
                </div>
                {!a.active && (
                  <Button size="sm" variant="outline" loading={isBusy(`sw:${a.id}`)} onClick={() => void act(`sw:${a.id}`, "/api/admin/ai/agy/switch", jsonInit("POST", { id: a.id }), `Đã chuyển sang ${a.email}`)}>
                    Dùng
                  </Button>
                )}
                <IconButton icon="trash" label="Gỡ" size="sm" onClick={() => setRemoving(a)} />
              </div>
              {(a.groups || (a.quota && a.quota.length > 0)) && (() => {
                const g = agyGroups(a);
                return (
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 sm:pl-[42px]">
                    <GroupCol vendor="google" title="Gemini" g={g.gemini} />
                    <GroupCol vendor="anthropic" title="Claude" g={g.claude} />
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
      <AddAgyModal open={adding} onClose={() => setAdding(false)} call={call} onDone={refresh} />
      <ConfirmDialog
        open={Boolean(removing)}
        title="Gỡ tài khoản?"
        body={removing?.email}
        danger
        confirmLabel="Gỡ"
        busy={isBusy("rm")}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await act("rm", `/api/admin/ai/agy/accounts/${encodeURIComponent(removing.id)}`, jsonInit("DELETE"), "Đã gỡ tài khoản");
          setRemoving(null);
        }}
      />
    </Panel>
  );
}

function StepDot({ n, on, done }: { n: number; on: boolean; done: boolean }) {
  return (
    <span
      className={cx(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold transition-colors duration-300",
        done ? "bg-ok text-black" : on ? "bg-accent text-accent-ink" : "bg-white/[.08] text-muted",
      )}
    >
      {done ? <Icon name="check" size={13} strokeWidth={2.4} /> : n}
    </span>
  );
}

function AddAgyModal({ open, onClose, call, onDone }: { open: boolean; onClose: () => void; call: Call; onDone: () => void }) {
  const toast = useToast();
  const { run, isBusy } = useAction();
  const [link, setLink] = useState<{ url: string; state: string } | null>(null);
  const [cb, setCb] = useState("");
  useEffect(() => {
    if (open) return;
    setLink(null);
    setCb("");
  }, [open]);

  async function getLink() {
    const r = await run("link", () => call<{ url: string; state: string }>("/api/admin/ai/agy/login", jsonInit("POST", {})), { silent: true });
    if (r) {
      setLink(r);
      window.open(r.url, "_blank", "noopener");
    }
  }

  async function finish() {
    if (!link) return;
    const r = await run("finish", () => call<{ account?: { id: string; email: string } }>("/api/admin/ai/agy/login/finish", jsonInit("POST", { state: link.state, callback: cb.trim() })), {
      silent: true,
    });
    if (r) {
      toast.success("Đã thêm tài khoản", { body: r.account?.email });
      onDone();
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Thêm tài khoản Google" size="sm">
      <ol className="space-y-5">
        <li className="flex gap-3">
          <StepDot n={1} on={!link} done={Boolean(link)} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium">Đăng nhập Google</p>
            {link ? (
              <a href={link.url} target="_blank" rel="noopener noreferrer" className="press inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
                Mở lại link <Icon name="external" size={14} />
              </a>
            ) : (
              <Button size="sm" variant="glass" icon="google" loading={isBusy("link")} onClick={() => void getLink()}>
                Lấy link Google
              </Button>
            )}
          </div>
        </li>
        <li className={cx("flex gap-3 transition-opacity duration-300", !link && "opacity-40")}>
          <StepDot n={2} on={Boolean(link)} done={false} />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-medium">Dán URL callback hoặc mã</p>
            <Textarea rows={3} value={cb} disabled={!link} onChange={(e) => setCb(e.target.value)} placeholder="http://localhost:…/callback?code=…" className="font-mono !text-[12.5px]" />
            <Button size="sm" variant="primary" icon="check" disabled={!link || cb.trim().length < 6} loading={isBusy("finish")} onClick={() => void finish()}>
              Hoàn tất
            </Button>
          </div>
        </li>
      </ol>
    </Modal>
  );
}

// ───────── Codex: profile + đăng nhập device-auth ─────────

export function CodexProfiles({
  codex,
  active,
  onActive,
  call,
  refresh,
  loading,
}: {
  codex?: CodexInfo;
  active: string;
  onActive: (name: string) => void;
  call: Call;
  refresh: () => void;
  loading?: boolean;
}) {
  const { run, isBusy } = useAction();
  const [login, setLogin] = useState<string | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const profiles = codex?.profiles ?? [];

  return (
    <Panel
      title="Tài khoản OpenAI"
      icon="cpu"
      pad={false}
      actions={
        <>
          <IconButton icon="refresh" label="Cập nhật quota" size="sm" loading={loading} onClick={refresh} />
          <Button size="sm" variant="outline" icon="plus" onClick={() => setLogin("")}>
            Thêm
          </Button>
        </>
      }
    >
      {profiles.length === 0 ? (
        <Empty icon="user" title={loading ? "Đang tải…" : "Chưa có profile"} className="py-10" />
      ) : (
        <ul role="radiogroup" aria-label="Profile đang dùng" className="divide-y divide-line">
          {profiles.map((p, i) => {
            const on = p.name === active;
            return (
              <li key={p.name} className="reveal px-4 py-3 sm:px-5" style={{ "--i": i } as React.CSSProperties}>
                <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Dùng ${p.name}`}
                  onClick={() => onActive(p.name)}
                  className="press flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className={cx("flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full transition-shadow duration-200", on ? "shadow-[inset_0_0_0_5px_var(--color-accent)]" : "shadow-[inset_0_0_0_1.5px_var(--color-line2)]")} />
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px] font-semibold">{p.name}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs">
                      {p.loggedIn ? (
                        <Badge tone="ok" dot>
                          {p.method || "Đã đăng nhập"}
                        </Badge>
                      ) : (
                        <Badge tone="neutral" dot>
                          Chưa đăng nhập
                        </Badge>
                      )}
                    </span>
                  </span>
                </button>
                {p.loggedIn ? (
                  <Button size="sm" variant="ghost" icon="logout" onClick={() => setOut(p.name)}>
                    Đăng xuất
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" icon="user" onClick={() => setLogin(p.name)}>
                    Đăng nhập
                  </Button>
                )}
                </div>
                {p.loggedIn && (
                  <div className="mt-2.5 pl-[30px]">
                    <CodexQuotaBars q={p.quota} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <CodexLoginModal profile={login} onClose={() => setLogin(null)} call={call} onDone={refresh} />
      <ConfirmDialog
        open={Boolean(out)}
        title="Đăng xuất OpenAI?"
        body={out ? `Profile ${out}` : undefined}
        danger
        confirmLabel="Đăng xuất"
        busy={isBusy("out")}
        onClose={() => setOut(null)}
        onConfirm={async () => {
          const r = await run("out", () => call("/api/admin/ai/codex/logout", jsonInit("POST", { profile: out })), { success: "Đã đăng xuất" });
          if (r !== undefined) refresh();
          setOut(null);
        }}
      />
    </Panel>
  );
}

type DeviceLogin = { loginId: string; url: string; code: string };

function CodexLoginModal({ profile, onClose, call, onDone }: { profile: string | null; onClose: () => void; call: Call; onDone: () => void }) {
  const toast = useToast();
  const { run, isBusy } = useAction();
  const [name, setName] = useState("");
  const [dev, setDev] = useState<DeviceLogin | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = profile !== null;
  const alive = useRef(0);

  useEffect(() => {
    alive.current++;
    if (!open) {
      setDev(null);
      setErr(null);
      return;
    }
    setName(profile || "");
  }, [open, profile]);

  // Hỏi trạng thái 2 s/lần tới khi xong (hủy khi đóng hộp thoại).
  useEffect(() => {
    if (!dev) return;
    const token = alive.current;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const s = await call<{ status: "waiting" | "done" | "error"; message?: string }>(`/api/admin/ai/codex/login/${encodeURIComponent(dev.loginId)}`);
        if (token !== alive.current) return;
        if (s.status === "done") {
          toast.success("Đã đăng nhập OpenAI", { body: name });
          onDone();
          onClose();
          return;
        }
        if (s.status === "error") return setErr(s.message || "Đăng nhập lỗi");
      } catch (e) {
        if (token !== alive.current) return;
        if ((e as Error).name === "AbortError") return;
      }
      timer = setTimeout(tick, 2000);
    };
    timer = setTimeout(tick, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dev]);

  async function start() {
    setErr(null);
    const r = await run("start", () => call<DeviceLogin>("/api/admin/ai/codex/login", jsonInit("POST", { profile: name.trim() || "default" })), { silent: true });
    if (r) setDev(r);
  }

  return (
    <Modal open={open} onClose={onClose} title="Đăng nhập OpenAI" size="sm">
      {!dev ? (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-[13px] font-medium text-fg/75">Profile</span>
            <TextInput value={name} onChange={(e) => setName(e.target.value.replace(/[^\w .-]/g, ""))} placeholder="default" className="font-mono" />
          </label>
          <Button variant="primary" size="sm" icon="qr" loading={isBusy("start")} onClick={() => void start()}>
            Lấy mã đăng nhập
          </Button>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-sm text-muted">Mở link, nhập mã:</p>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(dev.code).then(() => toast.success("Đã chép mã"))}
            className="press group relative mx-auto block rounded-m3 bg-black/40 px-6 py-4 hairline"
            aria-label="Chép mã"
          >
            <span className="absolute inset-0 rounded-m3 opacity-25 blur-xl" style={{ background: "var(--aura)" }} aria-hidden="true" />
            <span className="relative font-mono text-[34px] leading-none font-bold tracking-[0.18em] tabular-nums">{dev.code}</span>
            <span className="relative mt-2 flex items-center justify-center gap-1 text-[11px] text-dim group-hover:text-muted">
              <Icon name="copy" size={12} /> chép
            </span>
          </button>
          <a href={dev.url} target="_blank" rel="noopener noreferrer" className="press inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
            {dev.url.replace(/^https?:\/\//, "")}
            <Icon name="external" size={14} />
          </a>
          {err ? (
            <p className="text-sm text-danger">{err}</p>
          ) : (
            <p className="flex items-center justify-center gap-2 text-xs text-muted">
              <Spinner className="h-3.5 w-3.5" /> Đang chờ xác nhận…
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
