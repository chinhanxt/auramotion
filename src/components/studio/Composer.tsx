"use client";

import { useEffect, useRef } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
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

// Nút "AI viết" + chọn skill (nếu catalog có).
export function AiWriteButton({
  skills,
  skillId,
  onSkill,
  onWrite,
  pending,
  compact,
}: {
  skills: CatalogSkill[];
  skillId: string;
  onSkill: (id: string) => void;
  onWrite: () => void;
  pending: boolean;
  compact?: boolean;
}) {
  const skill = skills.find((s) => s.id === skillId);
  return (
    <div className="inline-flex shrink-0 items-center rounded-[11px] bg-white/[.04]">
      <button
        type="button"
        onClick={onWrite}
        disabled={pending}
        data-tip="AI viết lại prompt từ ý tưởng"
        className="press inline-flex h-9 items-center gap-1.5 rounded-[11px] px-2.5 text-[13px] font-medium text-fg/85 hover:bg-white/[.08] hover:text-fg disabled:opacity-60"
      >
        <span className={cx("flex", pending && "animate-spin [animation-duration:2.2s]")}>
          <Icon name="sparkle" size={16} className="text-accent" />
        </span>
        <span className={cx(compact && "max-sm:hidden")}>{pending ? "AI đang viết" : "AI viết"}</span>
      </button>
      {skills.length > 0 && (
        <Popover
          side="top"
          className="w-72"
          trigger={({ toggle, ref, ...aria }) => (
            <button
              ref={ref}
              type="button"
              onClick={toggle}
              {...aria}
              aria-label="Chọn skill"
              className="press -ml-1 inline-flex h-9 max-w-36 items-center gap-1 rounded-[11px] pr-2 pl-1.5 text-[12px] text-muted hover:bg-white/[.08] hover:text-fg"
            >
              {skill && <span className="truncate rounded-full bg-aura1/20 px-2 py-0.5 text-[11px] font-semibold text-[#c9bdff]">{skill.name}</span>}
              <Icon name="chevronDown" size={14} />
            </button>
          )}
        >
          {(close) => (
            <>
              <p className="px-2.5 pt-1.5 pb-1 t-label">Skill viết prompt</p>
              <MenuItem active={!skillId} onClick={() => (onSkill(""), close())} icon={<Icon name="sparkle" size={16} />}>
                Mặc định
              </MenuItem>
              {skills.map((s) => (
                <MenuItem
                  key={s.id}
                  active={s.id === skillId}
                  disabled={s.locked}
                  icon={<Icon name={s.locked ? "lock" : "wand"} size={16} />}
                  hint={s.locked ? "Pro" : undefined}
                  onClick={() => (onSkill(s.id), close())}
                >
                  <span className="block truncate">{s.name}</span>
                  {s.description && <span className="block truncate text-xs text-muted">{s.description}</span>}
                </MenuItem>
              ))}
            </>
          )}
        </Popover>
      )}
    </div>
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
