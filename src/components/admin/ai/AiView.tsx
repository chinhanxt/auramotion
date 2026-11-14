"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Notice } from "@/components/ui/Bits";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { api } from "@/lib/api-client";
import { LiveDot, providerState } from "../engine/live";
import { providerLabel } from "../format";
import { jsonInit, useAction, usePoll } from "../hooks";
import { Dot, PageHeader, SaveBar } from "../kit";
import { AgyAccounts, CodexProfiles, type Call } from "./Accounts";
import { Countdown, HealthLine } from "./bits";
import { demoAi, demoTest } from "./demo";
import { ProviderLogo } from "@/components/ui/VendorLogo";
import { RolesPanel, type ModelLists } from "./Roles";
import { TestBench, makeTestFn } from "./TestBench";
import { codexModels, normalizeRoles, toTime, type AiData, type AiProvider, type AiRoles } from "./types";

// Gọi giả cho ?demo=1: trả kết quả hợp lý cho từng endpoint, không chạm backend.
function demoCall(): Call {
  let polls = 0;
  return async <T,>(url: string, init?: RequestInit): Promise<T> => {
    await new Promise((r) => setTimeout(r, 450));
    const v = (x: unknown) => x as T;
    if (url === "/api/admin/skills")
      return v([
        { id: "s1", name: "Sản phẩm sạch", kind: "IMAGE" },
        { id: "s2", name: "Món Việt", kind: "IMAGE" },
        { id: "s3", name: "Chuyển động sản phẩm", kind: "VIDEO" },
      ]);
    if (url.endsWith("/agy/login")) return v({ url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=demo", state: "demo" });
    if (url.endsWith("/agy/login/finish")) return v({ account: { id: "a3", email: "new.account@gmail.com" } });
    if (url.endsWith("/codex/login") && init?.method === "POST") return v({ loginId: "demo", url: "https://auth.openai.com/codex/device", code: "KQ7M-4XPD" });
    if (url.includes("/codex/login/")) return v({ status: ++polls > 3 ? "done" : "waiting" });
    return v({ ok: true });
  };
}

function ProviderCard({
  p,
  data,
  loading,
  roles,
  setRoles,
  onRestart,
  restarting,
  i,
}: {
  p: AiProvider;
  data?: AiData;
  loading: boolean;
  roles: AiRoles;
  setRoles: (r: AiRoles) => void;
  onRestart: () => void;
  restarting: boolean;
  i: number;
}) {
  const pr = data?.providers;
  const agy = pr?.agy;
  const codex = pr?.codex;
  const muse = pr?.muse;
  const h = data?.health?.[p];
  const cd = toTime(data?.cooldowns?.[p]);
  const st = providerState(h);
  const installed = p === "agy" ? agy?.installed : p === "codex" ? codex?.installed : muse?.ok;
  const version = p === "agy" ? agy?.version : p === "codex" ? codex?.version : null;
  const museAcc = Array.isArray(muse?.accounts) ? muse.accounts.length : muse?.accounts;

  return (
    <section className="reveal relative min-w-0 overflow-hidden rounded-m3 bg-s1 p-4 hairline" style={{ "--i": i } as React.CSSProperties}>
      <span
        className={cx("pointer-events-none absolute -top-16 -right-10 h-40 w-40 rounded-full opacity-[.16] blur-3xl transition-opacity duration-700", st === "danger" && "opacity-[.08]")}
        style={{ background: p === "agy" ? "#9B72CB" : p === "codex" ? "#8e8e99" : "#0082FB" }}
        aria-hidden="true"
      />
      <div className="relative flex items-start gap-3">
        <ProviderLogo provider={p} size={38} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            {providerLabel(p, { chat: true })}
            {version && <span className="font-mono text-[11px] font-normal text-dim">v{version}</span>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {installed === undefined ? (loading ? "…" : "Không rõ") : installed ? (p === "muse" ? `muse2api · ${museAcc ?? 0} tài khoản` : "Đã cài") : p === "muse" ? "Không kết nối" : "Chưa cài"}
          </p>
        </div>
        {cd && cd > Date.now() && (
          <Badge tone="warn" className="tabular-nums">
            <Icon name="clock" size={12} />
            <Countdown until={cd} />
          </Badge>
        )}
      </div>

      <div className="relative mt-4 space-y-3">
        {p === "agy" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              size="sm"
              ariaLabel="Kênh gọi Google"
              value={roles.agy?.transport ?? "acp"}
              onChange={(transport) => setRoles({ ...roles, agy: { ...roles.agy, transport } })}
              options={[
                { value: "acp", label: "ACP", title: "Tiến trình chạy sẵn (~4 s)" },
                { value: "cli", label: "CLI", title: "Mỗi lần 1 tiến trình (6–10 s)" },
              ]}
            />
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <Dot tone={agy?.acp?.alive ? "ok" : agy?.acp ? "danger" : "neutral"} pulse={agy?.acp?.alive} />
              <span className="tabular-nums">
                {agy?.acp ? `${agy.acp.processes ?? 0} tiến trình · ${agy.acp.sessions ?? 0} phiên` : "ACP chưa chạy"}
              </span>
            </span>
            <IconButton icon="refresh" label="Khởi động lại ACP" size="sm" className="ml-auto" loading={restarting} onClick={onRestart} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="rounded-[7px] bg-white/[.06] px-2 py-1 font-mono text-[11px] text-fg/80">{p === "codex" ? "CLI" : "HTTP"}</span>
            {p === "codex" ? (
              <span className="truncate">
                profile <b className="font-mono font-medium text-fg/85">{roles.codex?.profile ?? "default"}</b>
              </span>
            ) : (
              <span className="truncate">chat chính · chat phụ</span>
            )}
          </div>
        )}
        <div className="border-t border-line pt-3">
          <HealthLine h={h} loading={loading} ready={!!installed} />
          {h?.lastError && st === "danger" && <p className="mt-1.5 line-clamp-2 text-xs break-words text-danger/85">{h.lastError}</p>}
        </div>
      </div>
    </section>
  );
}

export function AiView({ demo = false }: { demo?: boolean }) {
  const live = usePoll<AiData>(demo ? null : "/api/admin/ai", 10_000);
  const [demoData] = useState(() => (demo ? demoAi() : undefined));
  const data = demo ? demoData : live.data;
  const missing = !demo && (live.status === 404 || live.status === 405);
  const loading = !demo && live.loading;
  const call = useMemo<Call>(() => (demo ? demoCall() : <T,>(url: string, init?: RequestInit) => api<T>(url, init)), [demo]);
  const testFn = useMemo(() => (demo ? demoTest : makeTestFn(call)), [demo, call]);
  const { run, isBusy } = useAction();

  // Bản nháp roles: lấy từ lần tải đầu; poll sau không ghi đè khi đang sửa.
  const [base, setBase] = useState<AiRoles>(() => normalizeRoles(data?.roles));
  const [draft, setDraft] = useState<AiRoles>(base);
  const seeded = useRef(Boolean(data));
  useEffect(() => {
    if (seeded.current || !data) return;
    seeded.current = true;
    const r = normalizeRoles(data.roles);
    setBase(r);
    setDraft(r);
  }, [data]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);

  const refresh = useCallback(() => void live.refresh(), [live]);

  const models: ModelLists = useMemo(() => ({ agy: data?.providers?.agy?.models ?? [], codex: codexModels(data), muse: [] }), [data]);
  const profiles = useMemo(() => (data?.providers?.codex?.profiles ?? []).map((p) => p.name), [data]);

  async function save() {
    const r = await run("save", () => call<{ roles?: AiRoles } | AiRoles>("/api/admin/ai/roles", jsonInit("PUT", draft)), { success: "Đã lưu vai trò AI" });
    if (r === undefined) return;
    const saved = normalizeRoles(r && typeof r === "object" && "writer" in r ? (r as AiRoles) : ((r as { roles?: AiRoles } | null)?.roles ?? draft));
    setBase(saved);
    setDraft(saved);
    refresh();
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon="sparkle"
        title="AI & Model"
        sub={demo ? <Badge tone="info">Demo</Badge> : missing ? <span className="text-warn">API chưa sẵn sàng</span> : <LiveDot at={live.at} />}
        actions={<SaveBar dirty={dirty} busy={isBusy("save")} onSave={() => void save()} onReset={() => setDraft(base)} />}
      />
      {missing && (
        <Notice tone="info">
          Backend chưa có <code className="font-mono text-[12.5px]">/api/admin/ai</code> — đang hiện cấu hình mặc định.
        </Notice>
      )}
      {!missing && live.error && !data && <Notice tone="danger">{live.error}</Notice>}

      <div className="grid gap-3 md:grid-cols-3">
        {(["agy", "codex", "muse"] as AiProvider[]).map((p, i) => (
          <ProviderCard
            key={p}
            i={i}
            p={p}
            data={data}
            loading={loading}
            roles={draft}
            setRoles={setDraft}
            restarting={isBusy("acp")}
            onRestart={async () => {
              const r = await run("acp", () => call("/api/admin/ai/acp/restart", jsonInit("POST", {})), { success: "Đã khởi động lại ACP" });
              if (r !== undefined) refresh();
            }}
          />
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <AgyAccounts agy={data?.providers?.agy} call={call} refresh={refresh} loading={loading} />
        <CodexProfiles
          codex={data?.providers?.codex}
          active={draft.codex?.profile ?? "default"}
          onActive={(profile) => setDraft({ ...draft, codex: { ...draft.codex, profile } })}
          call={call}
          refresh={refresh}
          loading={loading}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <RolesPanel roles={draft} set={setDraft} models={models} profiles={profiles} />
        <TestBench models={models} call={call} chain={draft.writer.chain} testFn={testFn} />
      </div>
    </div>
  );
}
