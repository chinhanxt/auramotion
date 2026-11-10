"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Switch } from "@/components/ui/Controls";
import { MenuItem, Popover } from "@/components/ui/Overlay";
import { formatCredit, planLabel, type CatalogModel, type CatalogSkill } from "@/lib/api-client";

export const RATIO_LABEL: Record<string, string> = { "1:1": "Vuông", "9:16": "Dọc", "16:9": "Ngang", "4:5": "Dọc 4:5" };

export function RatioShape({ ratio, size = 16 }: { ratio: string; size?: number }) {
  const [w, h] = ratio.split(":").map(Number);
  const k = size / Math.max(w || 1, h || 1);
  return <span className="inline-block shrink-0 rounded-[3px] border-[1.6px] border-current" style={{ width: Math.max(6, w * k), height: Math.max(6, h * k) }} />;
}

// Ô nhập tự giãn theo nội dung (tối đa ~30% màn hình).
export function AutoTextarea({
  value,
  onChange,
  placeholder,
  onSubmit,
  maxLength = 2000,
  className,
  id,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSubmit?: () => void;
  maxLength?: number;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.3))}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={ariaLabel ?? placeholder}
      rows={1}
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSubmit?.();
        }
      }}
      className={cx("block w-full resize-none bg-transparent text-[15px] leading-relaxed text-fg outline-none placeholder:text-dim", className)}
    />
  );
}

export function ToolButton({
  children,
  onClick,
  active,
  className,
  tip,
  ...rest
}: React.ComponentProps<"button"> & { active?: boolean; tip?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-tip={tip}
      className={cx(
        "press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[11px] px-2.5 text-[13px] font-medium whitespace-nowrap disabled:opacity-40",
        active ? "bg-white/[.1] text-fg" : "bg-white/[.04] text-fg/80 hover:bg-white/[.08] hover:text-fg",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function AspectMenu({ ratios, value, onChange }: { ratios: string[]; value: string; onChange: (r: string) => void }) {
  if (ratios.length === 0) return null;
  return (
    <Popover
      side="top"
      trigger={({ toggle, ref, ...aria }) => (
        <ToolButton ref={ref} onClick={toggle} {...aria} tip="Tỷ lệ khung">
          <RatioShape ratio={value || ratios[0]} />
          {value}
        </ToolButton>
      )}
    >
      {(close) =>
        ratios.map((r) => (
          <MenuItem
            key={r}
            active={r === value}
            icon={<RatioShape ratio={r} size={18} />}
            hint={RATIO_LABEL[r]}
            onClick={() => {
              onChange(r);
              close();
            }}
          >
            {r}
          </MenuItem>
        ))
      }
    </Popover>
  );
}

export function EngineMenu({ models, value, onChange, unit }: { models: CatalogModel[]; value: string; onChange: (m: CatalogModel) => void; unit: string }) {
  const sel = models.find((m) => m.id === value);
  if (models.length <= 1 && sel) {
    return (
      <span className="inline-flex h-9 items-center gap-1.5 px-1.5 text-[13px] text-muted" data-tip="Engine">
        <Icon name="cpu" size={16} />
        {sel.name}
      </span>
    );
  }
  return (
    <Popover
      side="top"
      className="w-72"
      trigger={({ toggle, ref, ...aria }) => (
        <ToolButton ref={ref} onClick={toggle} {...aria} tip="Engine">
          <Icon name="cpu" size={16} />
          {sel?.name ?? "Engine"}
          <Icon name="chevronDown" size={14} className="text-muted" />
        </ToolButton>
      )}
    >
      {(close) => (
        <>
          <p className="px-2.5 pt-1.5 pb-1 t-label">Engine</p>
          {models.map((m) => (
            <MenuItem
              key={m.id}
              active={m.id === value}
              disabled={m.locked}
              icon={<Icon name={m.locked ? "lock" : m.id === value ? "check" : "cpu"} size={16} />}
              hint={m.locked ? planLabel(m.minPlanRank) : `${formatCredit(m.baseCost)}/${unit}`}
              onClick={() => {
                onChange(m);
                close();
              }}
            >
              {m.name}
            </MenuItem>
          ))}
          {sel && (sel.provider === "AGY" || sel.provider === "CODEX") && <p className="px-2.5 pt-1 pb-1.5 text-xs text-muted">Mỗi ảnh mất 1–4 phút.</p>}
        </>
      )}
    </Popover>
  );
}

// Lọc + nhóm skill theo `category` (≈50 skill): tìm theo tên, mô tả, tag.
function groupSkills(skills: CatalogSkill[], q: string): [string, CatalogSkill[]][] {
  const s = q.trim().toLowerCase();
  const hit = s
    ? skills.filter((k) => [k.name, k.description, k.category, ...(k.tags ?? [])].some((x) => x?.toLowerCase().includes(s)))
    : skills;
  const groups = new Map<string, CatalogSkill[]>();
  for (const k of hit) {
    const g = k.category?.trim() || "";
    groups.set(g, [...(groups.get(g) ?? []), k]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "vi")));
}

function SkillList({ skills, skillId, onPick }: { skills: CatalogSkill[]; skillId: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => groupSkills(skills, q), [skills, q]);
  const many = skills.length > 8;
  return (
    <>
      <p className="px-2.5 pt-1.5 pb-1 t-label">Skill</p>
      {many && (
        <div className="relative px-1 pb-1">
          <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm skill…"
            aria-label="Tìm skill"
            className="h-8 w-full rounded-[9px] bg-white/[.05] pr-2 pl-8 text-[13px] outline-none placeholder:text-dim focus:bg-white/[.08]"
          />
        </div>
      )}
      {!q && (
        <MenuItem active={!skillId} onClick={() => onPick("")} icon={<Icon name={!skillId ? "check" : "sparkle"} size={16} />} hint="AI chọn">
          Tự chọn
        </MenuItem>
      )}
      <div className={cx(many && "max-h-[42vh] overflow-y-auto overscroll-contain")}>
        {groups.map(([g, list]) => (
          <div key={g || "_"}>
            {g && groups.length > 1 && <p className="sticky top-0 z-[1] bg-s2 px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.06em] text-dim uppercase">{g}</p>}
            {list.map((s) => (
              <MenuItem
                key={s.id}
                active={s.id === skillId}
                disabled={s.locked}
                icon={<Icon name={s.locked ? "lock" : s.id === skillId ? "check" : "wand"} size={16} />}
                hint={s.locked ? "Pro" : undefined}
                onClick={() => onPick(s.id)}
              >
                <span className="block truncate">{s.name}</span>
                {s.description && <span className="block truncate text-xs text-muted">{s.description}</span>}
              </MenuItem>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="px-2.5 py-3 text-center text-xs text-dim">Không có skill khớp</p>}
      </div>
    </>
  );
}

export type PrewriteView = { status: "idle" | "writing" | "ready"; prompt?: string; provider?: string; skillName?: string };

// Một nút skill duy nhất của composer: bật/tắt "AI viết" (Tạo → AI Gateway viết prompt từ ý tưởng rồi gửi engine),
// chọn skill (Tự chọn = gateway tự chọn), và "Viết vào ô để sửa" cho ai muốn xem prompt trước.
// `prewrite`: AI viết trước khi người dùng ngừng gõ — chấm trên nút (đang viết / sẵn sàng), xem trước trong menu.
export function AiWriteControl({
  skills,
  skillId,
  onSkill,
  on,
  onToggle,
  onWrite,
  pending,
  writer = "agy",
  prewrite,
  onUsePrewrite,
}: {
  skills: CatalogSkill[];
  skillId: string;
  onSkill: (id: string) => void;
  on: boolean;
  onToggle: (v: boolean) => void;
  onWrite: () => void;
  pending: boolean;
  writer?: string;
  prewrite?: PrewriteView;
  onUsePrewrite?: (prompt: string) => void;
}) {
  const skill = skills.find((s) => s.id === skillId);
  const pre = on && prewrite && prewrite.status !== "idle" ? prewrite : null;
  const ready = pre?.status === "ready" && Boolean(pre.prompt);
  return (
    <Popover
      side="top"
      className="w-80"
      trigger={({ toggle, ref, ...aria }) => (
        <button
          ref={ref}
          type="button"
          onClick={toggle}
          {...aria}
          aria-label="AI viết prompt"
          data-tip={ready ? "Đã viết trước — Tạo dùng ngay" : pre ? "AI đang viết trước…" : on ? "Tạo: AI viết prompt rồi gửi engine" : "Tạo: gửi nguyên văn"}
          className={cx(
            "press inline-flex h-9 max-w-60 shrink-0 items-center gap-1.5 rounded-[11px] px-2.5 text-[13px] font-medium whitespace-nowrap",
            on ? "bg-aura1/15 text-fg shadow-[inset_0_0_0_1px_rgba(124,92,255,.35)] hover:bg-aura1/25" : "bg-white/[.04] text-muted hover:bg-white/[.08] hover:text-fg",
          )}
        >
          <span className={cx("relative flex shrink-0", pending && "animate-spin [animation-duration:2.2s]")}>
            <Icon name="sparkle" size={16} className={on || pending ? "text-accent" : undefined} />
            {pre && !pending && (
              <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2" aria-hidden="true">
                {!ready && <span className="absolute inset-0 animate-ping rounded-full bg-[#b7a6ff]" />}
                <span className={cx("relative h-2 w-2 rounded-full shadow-[0_0_0_2px_rgba(13,13,16,.9)]", ready ? "bg-accent" : "bg-[#b7a6ff]")} />
              </span>
            )}
          </span>
          {pending ? (
            <span>AI đang viết</span>
          ) : on ? (
            <>
              <span className="max-sm:hidden">{writer} viết</span>
              <span className="text-muted max-sm:hidden">·</span>
              <span className="min-w-0 truncate text-[#c9bdff]">{skill?.name ?? pre?.skillName ?? "Tự chọn"}</span>
            </>
          ) : (
            <span>Gửi nguyên văn</span>
          )}
          <Icon name="chevronDown" size={14} className="shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-1.5 pt-1 pb-1">
            <Switch checked={on} onChange={onToggle} label="AI viết prompt" hint={on ? `Tạo: ${writer} viết rồi gửi engine` : "Tạo: gửi nguyên văn"} icon="sparkle" />
          </div>
          {pre && (
            <div className="mx-1 mb-1 rounded-[10px] bg-black/30 p-2.5 hairline">
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
                <span className={cx("h-1.5 w-1.5 rounded-full", ready ? "bg-accent" : "animate-pulse bg-[#b7a6ff]")} />
                <span className={ready ? "text-accent" : "text-[#c9bdff]"}>{ready ? "Sẵn sàng" : "Đang viết trước…"}</span>
                {(pre.provider || pre.skillName) && <span className="min-w-0 truncate text-dim">· {[pre.provider, pre.skillName].filter(Boolean).join(" · ")}</span>}
              </p>
              {ready ? (
                <p className="mt-1.5 max-h-28 overflow-y-auto text-[12px] leading-relaxed whitespace-pre-wrap text-fg/80">{pre.prompt}</p>
              ) : (
                <span className="write-lines mt-2 block space-y-1.5" aria-hidden="true">
                  <i style={{ width: "90%" }} />
                  <i style={{ width: "64%" }} />
                </span>
              )}
            </div>
          )}
          {skills.length > 0 && <SkillList skills={skills} skillId={skillId} onPick={(id) => (onSkill(id), close())} />}
          <div className="mx-2 my-1 h-px bg-line" />
          {ready && onUsePrewrite ? (
            <MenuItem icon={<Icon name="edit" size={16} />} onClick={() => (close(), onUsePrewrite(pre!.prompt!))}>
              Đưa bản viết trước vào ô
            </MenuItem>
          ) : (
            <MenuItem icon={<Icon name="edit" size={16} />} disabled={pending} onClick={() => (close(), onWrite())}>
              Viết vào ô để sửa
            </MenuItem>
          )}
        </>
      )}
    </Popover>
  );
}

export function GenerateButton({
  cost,
  quoting,
  pending,
  disabled,
  label = "Tạo",
  onClick,
  type = "submit",
}: {
  cost: number | null;
  quoting: boolean;
  pending: boolean;
  disabled: boolean;
  label?: string;
  onClick?: () => void;
  type?: "submit" | "button";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || pending || cost === null}
      className="press group inline-flex h-11 shrink-0 items-center gap-2 rounded-m2 bg-accent pr-2 pl-4 text-[15px] font-bold text-accent-ink shadow-[0_10px_30px_-10px_rgba(212,255,58,.6)] hover:bg-[#e0ff6b] disabled:bg-white/[.08] disabled:text-muted disabled:shadow-none"
    >
      {pending ? "Đang gửi" : label}
      <span className="inline-flex h-7 min-w-11 items-center justify-center gap-1 rounded-[10px] bg-black/10 px-2 text-[13px] font-semibold tabular-nums group-disabled:bg-white/[.06]">
        <Icon name="bolt" size={13} strokeWidth={2} />
        {quoting && cost === null ? "…" : cost === null ? "—" : formatCredit(cost)}
      </span>
    </button>
  );
}
