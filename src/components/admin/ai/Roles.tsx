"use client";

import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { ProviderLogo } from "@/components/ui/VendorLogo";
import { providerLabel } from "../format";
import { NumberInput, Panel } from "../kit";
import { EffortPicker, ModelSelect } from "./ModelSelect";
import { AI_PROVIDERS, type AiModel, type AiProvider, type AiRoles, type ChainStep, type Strategy } from "./types";

export type ModelLists = Record<AiProvider, AiModel[]>;

// Danh sách bước (provider + model + effort): kéo để đổi thứ tự, nút lên/xuống cho màn chạm.
export function ChainEditor({
  chain,
  onChange,
  models,
  strategy = "fallback",
  max = 5,
  profiles = [],
}: {
  chain: ChainStep[];
  onChange: (c: ChainStep[]) => void;
  models: ModelLists;
  strategy?: Strategy;
  max?: number;
  profiles?: string[];
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= chain.length || from === to) return;
    const next = [...chain];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    onChange(next);
  };
  const patch = (i: number, p: Partial<ChainStep>) => onChange(chain.map((s, j) => (j === i ? { ...s, ...p } : s)));
  const setProvider = (i: number, provider: AiProvider) => {
    const m = models[provider][0];
    patch(i, { provider, model: provider === "muse" ? undefined : m?.id, effort: provider === "codex" ? (m?.defaultEffort ?? m?.efforts?.[0]) : undefined, profile: undefined });
  };

  return (
    <div>
      <ol className="space-y-0">
        {chain.map((s, i) => {
          const list = models[s.provider];
          const m = list.find((x) => x.id === s.model);
          const raced = strategy === "race" && i < 2;
          return (
            <li key={`${i}-${s.provider}`}>
              {i > 0 && (
                <div className="flex h-6 items-center pl-[22px]" aria-hidden="true">
                  <span className={cx("h-full w-px", raced ? "bg-aura2/60" : "bg-line2")} />
                  <span className={cx("ml-3 text-[10.5px] font-medium tracking-wide uppercase", raced ? "text-aura2" : "text-dim")}>{raced ? "song song" : "lỗi → tiếp"}</span>
                </div>
              )}
              <div
                draggable
                onDragStart={(e) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (over !== i) setOver(i);
                }}
                onDragLeave={() => setOver((o) => (o === i ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag !== null) move(drag, i);
                  setDrag(null);
                  setOver(null);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                className={cx(
                  "flex flex-wrap items-center gap-2 rounded-m2 bg-white/[.025] p-2 hairline transition-[background-color,opacity,box-shadow] duration-200",
                  drag === i && "opacity-40",
                  over === i && drag !== i && "bg-accent/[.06] shadow-[inset_0_0_0_1px_rgba(212,255,58,.35)]",
                )}
              >
                <span className="hidden cursor-grab text-dim active:cursor-grabbing sm:block" aria-hidden="true">
                  <Icon name="drag" size={16} />
                </span>
                <span className="relative">
                  <ProviderLogo provider={s.provider} model={s.model} size={30} />
                  <span className="absolute -right-1 -bottom-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-s1 px-0.5 text-[10px] font-bold tabular-nums shadow-[0_0_0_1px_var(--color-line2)]">{i + 1}</span>
                </span>
                <Segmented size="sm" ariaLabel="Provider" value={s.provider} onChange={(p) => setProvider(i, p)} options={AI_PROVIDERS.map((p) => ({ value: p, label: providerLabel(p, { chat: true }) }))} />
                <div className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-2">
                  {s.provider === "codex" && profiles.length > 1 && (
                    <Select
                      inputSize="sm"
                      aria-label="Profile OpenAI"
                      className="w-32 shrink-0"
                      value={s.profile ?? ""}
                      onChange={(e) => patch(i, { profile: e.target.value || undefined })}
                    >
                      <option value="">Profile chung</option>
                      {profiles.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </Select>
                  )}
                  {s.provider === "muse" ? (
                    <span className="flex h-9 min-w-0 flex-1 items-center px-1 text-[13px] text-dim">Muse Chat</span>
                  ) : (
                    <ModelSelect
                      models={list}
                      value={s.model ?? ""}
                      profile={s.provider === "codex" ? s.profile : undefined}
                      className="min-w-40 flex-1"
                      onChange={(id) => {
                        const nm = list.find((x) => x.id === id);
                        patch(i, { model: id || undefined, ...(s.provider === "codex" ? { effort: nm?.efforts?.includes(s.effort ?? "") ? s.effort : (nm?.defaultEffort ?? nm?.efforts?.[0]) } : {}) });
                      }}
                    />
                  )}
                  {s.provider === "codex" && m?.efforts && <EffortPicker compact efforts={m.efforts} value={s.effort ?? m.defaultEffort ?? ""} onChange={(effort) => patch(i, { effort })} />}
                </div>
                <span className="ml-auto flex shrink-0 items-center">
                  <IconButton icon="chevronUp" label="Lên" size="sm" disabled={i === 0} onClick={() => move(i, i - 1)} />
                  <IconButton icon="chevronDown" label="Xuống" size="sm" disabled={i === chain.length - 1} onClick={() => move(i, i + 1)} />
                  <IconButton icon="close" label="Bỏ bước" size="sm" disabled={chain.length <= 1} onClick={() => onChange(chain.filter((_, j) => j !== i))} />
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {chain.length < max && (
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          className="mt-2"
          onClick={() => {
            const used = new Set(chain.map((c) => c.provider));
            const p = AI_PROVIDERS.find((x) => !used.has(x)) ?? "agy";
            const m = models[p][0];
            onChange([...chain, { provider: p, ...(p !== "muse" && m ? { model: m.id } : {}), ...(p === "codex" && m ? { effort: m.defaultEffort ?? m.efforts?.[0] } : {}) }]);
          }}
        >
          Thêm bước
        </Button>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function RolesPanel({ roles, set, models, profiles }: { roles: AiRoles; set: (r: AiRoles) => void; models: ModelLists; profiles?: string[] }) {
  const w = roles.writer;
  return (
    <Panel title="Vai trò AI" icon="route">
      <div className="space-y-6">
        <Section title="AI viết prompt" hint="Ý tưởng → prompt cho engine">
          <ChainEditor chain={w.chain} strategy={w.strategy} models={models} profiles={profiles} onChange={(chain) => set({ ...roles, writer: { ...w, chain } })} />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            <Segmented<Strategy>
              size="sm"
              ariaLabel="Chiến lược"
              value={w.strategy ?? "fallback"}
              onChange={(strategy) => set({ ...roles, writer: { ...w, strategy } })}
              options={[
                { value: "fallback", label: "Lần lượt" },
                { value: "race", label: "Đua song song", disabled: w.chain.length < 2 },
              ]}
            />
            <span className="text-xs text-muted">{w.strategy === "race" ? "2 bước đầu chạy cùng lúc, lấy cái xong trước" : "Bước lỗi / quá giờ thì sang bước sau"}</span>
            <span className="ml-auto flex items-center gap-2 text-[13px] text-muted">
              Hết giờ
              <NumberInput className="w-28" value={w.timeoutSec ?? 60} min={5} max={600} step="1" suffix="giây" onChange={(v) => set({ ...roles, writer: { ...w, timeoutSec: Number(v) } })} />
            </span>
          </div>
        </Section>
        <div className="h-px bg-line" />
        <Section title="Lập kịch bản Story" hint="Chat chính lên kế hoạch các cảnh">
          <ChainEditor chain={roles.story.chain} models={models} profiles={profiles} onChange={(chain) => set({ ...roles, story: { chain } })} />
        </Section>
        <div className="h-px bg-line" />
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-m2 bg-white/[.025] px-2 py-1 hairline">
            <Switch icon="bolt" checked={roles.prewrite !== false} onChange={(prewrite) => set({ ...roles, prewrite })} label="Viết trước" hint="AI viết khi người dùng còn gõ" />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-m2 bg-white/[.025] px-3 py-2 hairline">
            <span className="flex items-center gap-3 text-sm text-fg/90">
              <Icon name="layers" size={18} className="text-muted" />
              Giữ cache
            </span>
            <NumberInput className="w-28" value={roles.cacheHours ?? 72} min={0} max={720} step="1" suffix="giờ" onChange={(v) => set({ ...roles, cacheHours: Number(v) })} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
