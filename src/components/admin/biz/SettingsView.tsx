"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { jsonInit, useAction, useDraft } from "@/components/admin/hooks";
import { FieldRow, NumberInput, PageHeader, Panel, SaveBar, TextInput } from "@/components/admin/kit";
import { PROVIDER_LABEL, formatVnd } from "@/components/admin/format";
import { Notice } from "@/components/ui/Bits";
import { IconButton } from "@/components/ui/Button";
import { Stepper, Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api-client";

type Provider = "agy" | "codex" | "muse";
type StoryS = { planCost: number; maxShots: number; planner: Provider; assemble: { musicId?: string; subtitles?: boolean; keepClipAudio?: boolean } };
type Pack = { credits: number; price: number };

function patch(body: Record<string, unknown>) {
  return api("/api/admin/settings", jsonInit("PATCH", body));
}

function Maintenance({ initial }: { initial: boolean }) {
  const { run, isBusy } = useAction();
  const [on, setOn] = useState(initial);
  async function toggle(v: boolean) {
    setOn(v);
    const ok = await run("m", () => patch({ maintenance: v }), { success: v ? "Đã bật bảo trì" : "Đã tắt bảo trì" });
    if (!ok) setOn(!v);
  }
  return (
    <Panel title="Bảo trì" icon="shield">
      <Switch checked={on} disabled={isBusy("m")} onChange={toggle} label="Chế độ bảo trì" hint="Chặn tạo tác vụ mới" />
      {on && (
        <Notice tone="warn" icon="alert" className="mt-3">
          Đang bảo trì — người dùng không tạo được tác vụ.
        </Notice>
      )}
    </Panel>
  );
}

function PromptWriter({ initial }: { initial: { provider: "agy" | "codex"; model: string } }) {
  const { run, isBusy } = useAction();
  const { draft, set, dirty, reset, commit } = useDraft(initial);
  async function save() {
    if (await run("pw", () => patch({ prompt_writer: draft }), { success: "Đã lưu AI viết prompt" })) commit(draft);
  }
  return (
    <Panel title="AI viết prompt" icon="wand">
      <div className="space-y-3">
        <Segmented
          size="sm"
          ariaLabel="Engine"
          value={draft.provider}
          onChange={(v) => set("provider", v)}
          options={[
            { value: "agy" as const, label: "agy" },
            { value: "codex" as const, label: "Codex" },
          ]}
        />
        <FieldRow label="Model" hint={draft.provider === "agy" ? "Bắt buộc với agy" : "Trống = mặc định"}>
          <TextInput value={draft.model} placeholder="claude-sonnet-5-5-low" onChange={(e) => set("model", e.target.value)} />
        </FieldRow>
        <SaveBar dirty={dirty} busy={isBusy("pw")} onSave={save} onReset={reset} />
      </div>
    </Panel>
  );
}

function StorySettings({ initial, tracks }: { initial: StoryS; tracks: { id: string; name: string }[] }) {
  const { run, isBusy } = useAction();
  const source = useMemo(() => ({ ...initial, planCost: String(initial.planCost) }), [initial]);
  const { draft, set, dirty, reset, commit } = useDraft(source);
  const setAsm = (patchA: Partial<StoryS["assemble"]>) => set("assemble", { ...draft.assemble, ...patchA });
  async function save() {
    const assemble = { ...draft.assemble };
    if (!assemble.musicId) delete assemble.musicId;
    const body = { planCost: Number(draft.planCost), maxShots: draft.maxShots, planner: draft.planner, assemble };
    if (await run("story", () => patch({ story: body }), { success: "Đã lưu Story" })) commit(draft);
  }
  return (
    <Panel title="Story" icon="story">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <FieldRow label="Phí lập kịch bản">
            <NumberInput value={draft.planCost} onChange={(v) => set("planCost", v)} min={0} step="0.1" suffix="Credit" />
          </FieldRow>
          <div className="space-y-1.5">
            <span className="block text-[13px] font-medium text-fg/75">Số cảnh tối đa</span>
            <Stepper ariaLabel="Số cảnh tối đa" value={draft.maxShots} min={2} max={8} onChange={(v) => set("maxShots", v)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-fg/75">Lập kịch bản bằng</span>
          <Segmented
            size="sm"
            ariaLabel="Planner"
            value={draft.planner}
            onChange={(v) => set("planner", v)}
            options={(["muse", "agy", "codex"] as const).map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
          />
        </div>
        <div className="space-y-1 rounded-m2 bg-white/[.02] p-3 hairline">
          <p className="t-label mb-2 text-[10px]">Tự ghép</p>
          <FieldRow label="Nhạc nền">
            <Select inputSize="sm" value={draft.assemble.musicId ?? ""} onChange={(e) => setAsm({ musicId: e.target.value || undefined })}>
              <option value="">Không nhạc</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </FieldRow>
          <Switch icon="subtitles" checked={Boolean(draft.assemble.subtitles)} onChange={(v) => setAsm({ subtitles: v })} label="Phụ đề" />
          <Switch icon="volume" checked={draft.assemble.keepClipAudio !== false} onChange={(v) => setAsm({ keepClipAudio: v })} label="Giữ tiếng clip" />
        </div>
        <SaveBar dirty={dirty} busy={isBusy("story")} onSave={save} onReset={reset} />
      </div>
    </Panel>
  );
}

function CreditPacks({ initial }: { initial: Pack[] }) {
  const { run, isBusy } = useAction();
  const toast = useToast();
  const source = useMemo(() => initial.map((p) => ({ credits: String(p.credits), price: String(p.price) })), [initial]);
  const { draft, setDraft, dirty, reset, commit } = useDraft(source);
  const update = (i: number, k: "credits" | "price", v: string) => setDraft((d) => d.map((r, n) => (n === i ? { ...r, [k]: v } : r)));
  async function save() {
    const packs = draft.map((r) => ({ credits: Number(r.credits), price: Number(r.price) }));
    if (packs.length === 0) return void toast.error("Cần ít nhất 1 gói");
    if (packs.some((p) => !Number.isInteger(p.credits) || p.credits <= 0 || !Number.isInteger(p.price) || p.price <= 0)) return void toast.error("Credit và giá phải là số nguyên > 0");
    if (new Set(packs.map((p) => p.credits)).size !== packs.length) return void toast.error("Số Credit các gói bị trùng");
    packs.sort((a, b) => a.credits - b.credits);
    if (await run("packs", () => patch({ credit_packs: packs }), { success: `Đã lưu ${packs.length} gói` })) {
      commit(packs.map((p) => ({ credits: String(p.credits), price: String(p.price) })));
    }
  }
  return (
    <Panel
      title="Gói Credit lẻ"
      icon="coin"
      actions={<IconButton icon="plus" label="Thêm gói" size="sm" onClick={() => setDraft((d) => [...d, { credits: "", price: "" }])} />}
    >
      <ul className="space-y-2">
        {draft.map((r, i) => {
          const unit = Number(r.price) / Number(r.credits);
          return (
            <li key={i} className="flex items-center gap-2">
              <NumberInput aria-label="Credit" value={r.credits} onChange={(v) => update(i, "credits", v)} step="1" min={1} suffix="Credit" className="flex-1" />
              <NumberInput aria-label="Giá" value={r.price} onChange={(v) => update(i, "price", v)} step="1000" min={1} suffix="₫" className="flex-1" />
              <span className="hidden w-24 shrink-0 text-right text-xs text-dim tabular-nums sm:block">{Number.isFinite(unit) && unit > 0 ? `${formatVnd(Math.round(unit))}/Cr` : ""}</span>
              <IconButton icon="trash" label="Xóa gói" size="sm" onClick={() => setDraft((d) => d.filter((_, n) => n !== i))} />
            </li>
          );
        })}
        {draft.length === 0 && <li className="py-3 text-center text-sm text-muted">Chưa có gói</li>}
      </ul>
      <div className="mt-3">
        <SaveBar dirty={dirty} busy={isBusy("packs")} onSave={save} onReset={reset} />
      </div>
    </Panel>
  );
}

function LinkCard({ href, icon, title, lines }: { href: string; icon: IconName; title: string; lines: string[] }) {
  return (
    <Link href={href} className="press lift group flex items-center gap-3 rounded-m3 bg-s1 p-4 hairline hover:bg-s2">
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-m1 bg-s3">
        <span className="absolute inset-0 rounded-m1 opacity-25 blur-md" style={{ background: "var(--aura)" }} />
        <Icon name={icon} size={18} className="relative" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {lines.map((l) => (
          <span key={l} className="block truncate text-xs text-muted">
            {l}
          </span>
        ))}
      </span>
      <Icon name="chevronRight" size={18} className={cx("text-dim transition-transform duration-200 group-hover:translate-x-0.5")} />
    </Link>
  );
}

export function SettingsView({
  maintenance,
  promptWriter,
  story,
  packs,
  museSlots,
  gateway,
  tracks,
}: {
  maintenance: boolean;
  promptWriter: { provider: "agy" | "codex"; model: string };
  story: StoryS;
  packs: Pack[];
  museSlots: { image: number; video: number; chat: number; gapSec: number } | null;
  gateway: { order: Provider[]; timeoutSec: number } | null;
  tracks: { id: string; name: string }[];
}) {
  return (
    <>
      <PageHeader icon="gear" title="Cài đặt" />
      <div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <div className="space-y-4">
          <Maintenance initial={maintenance} />
          <PromptWriter initial={promptWriter} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <LinkCard
              href="/admin/muse"
              icon="bolt"
              title="Slot Muse"
              lines={[museSlots ? `Ảnh ${museSlots.image} · Video ${museSlots.video} · Chat ${museSlots.chat}` : "Mặc định", museSlots ? `Giãn ${museSlots.gapSec}s` : ""].filter(Boolean)}
            />
            <LinkCard
              href="/admin/gateway"
              icon="route"
              title="AI Gateway"
              lines={[gateway ? gateway.order.map((p) => PROVIDER_LABEL[p]).join(" → ") : "Mặc định", gateway ? `Timeout ${gateway.timeoutSec}s` : ""].filter(Boolean)}
            />
          </div>
        </div>
        <StorySettings initial={story} tracks={tracks} />
        <CreditPacks initial={packs} />
      </div>
    </>
  );
}
