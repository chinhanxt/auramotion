"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { inputClass } from "@/components/ui/Field";
import { Icon } from "@/components/ui/Icon";
import { Popover } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import type { AiModel } from "./types";

function ProfileTags({ list, all }: { list?: string[]; all: number }) {
  if (!list?.length || all <= 1) return null;
  if (list.length >= all) return <span className="shrink-0 text-[10.5px] text-dim">mọi profile</span>;
  return (
    <span className="flex shrink-0 gap-1">
      {list.slice(0, 2).map((p) => (
        <span key={p} className="rounded-[5px] bg-white/[.06] px-1.5 py-px font-mono text-[10px] text-muted">
          {p}
        </span>
      ))}
      {list.length > 2 && <span className="text-[10.5px] text-dim">+{list.length - 2}</span>}
    </span>
  );
}

// Ô chọn model có tìm kiếm; gõ tên lạ + Enter để dùng model ngoài danh sách.
// Codex: lọc theo profile (catalog khác nhau theo tài khoản), model ẩn chỉ hiện khi bật.
export function ModelSelect({
  models,
  value,
  onChange,
  placeholder = "Mặc định",
  className,
  disabled,
  ariaLabel = "Model",
  profile,
}: {
  models: AiModel[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  profile?: string;
}) {
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [pf, setPf] = useState(profile ?? "");
  useEffect(() => setPf(profile ?? ""), [profile]);
  const input = useRef<HTMLInputElement>(null);
  const allProfiles = useMemo(() => [...new Set(models.flatMap((m) => m.profiles ?? []))], [models]);
  const anyHidden = models.some((m) => m.hidden);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return models.filter(
      (m) =>
        (showHidden || !m.hidden || m.id === value) &&
        (!pf || !m.profiles || m.profiles.includes(pf)) &&
        (!s || m.id.toLowerCase().includes(s) || m.name?.toLowerCase().includes(s)),
    );
  }, [models, q, showHidden, pf, value]);
  useEffect(() => setHi(0), [q, pf, showHidden]);
  const sel = models.find((m) => m.id === value);
  const custom = q.trim() && !models.some((m) => m.id === q.trim()) ? q.trim() : null;

  return (
    <Popover
      className="w-[min(340px,92vw)] !p-0"
      trigger={({ toggle, ref, open, ...aria }) => (
        <button
          ref={ref}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          onClick={() => {
            toggle();
            setQ("");
            setTimeout(() => input.current?.focus(), 30);
          }}
          {...aria}
          className={cx(
            inputClass,
            "press flex h-9 min-w-0 items-center gap-2 text-left text-[13px]",
            open && "shadow-[inset_0_0_0_1px_rgba(212,255,58,.7)]",
            className,
          )}
        >
          <span className={cx("min-w-0 flex-1 truncate font-mono text-[12.5px]", !value && "font-sans text-dim")}>{value ? (sel?.id ?? value) : placeholder}</span>
          <Icon name="chevronDown" size={15} className="shrink-0 text-muted" />
        </button>
      )}
    >
      {(close) => {
        const pick = (id: string) => {
          onChange(id);
          close();
        };
        return (
          <div className="flex max-h-[inherit] flex-col">
            <div className="relative border-b border-line p-1.5">
              <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-dim" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm model…"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(list.length - 1, h + 1)));
                  if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)));
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (list[hi]) pick(list[hi].id);
                    else if (custom) pick(custom);
                  }
                }}
                className="h-9 w-full rounded-[9px] bg-white/[.04] pr-3 pl-8 text-[13px] outline-none placeholder:text-dim"
              />
            </div>
            {(allProfiles.length > 1 || anyHidden) && (
              <div className="no-scrollbar flex items-center gap-1 overflow-x-auto border-b border-line px-1.5 py-1.5">
                {anyHidden && (
                  <button
                    type="button"
                    aria-pressed={showHidden}
                    onClick={() => setShowHidden((v) => !v)}
                    className={cx("press inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium", showHidden ? "bg-aura1/25 text-fg" : "text-dim hover:text-fg")}
                  >
                    <Icon name="eye" size={12} /> Model ẩn
                  </button>
                )}
                {allProfiles.length > 1 &&
                  ["", ...allProfiles].map((p) => (
                    <button
                      key={p || "*"}
                      type="button"
                      onClick={() => setPf(p)}
                      className={cx(
                        "press h-6 shrink-0 rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
                        pf === p ? "bg-fg text-bg" : "bg-white/[.05] text-muted hover:text-fg",
                      )}
                    >
                      {p || "Mọi profile"}
                    </button>
                  ))}
              </div>
            )}
            <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {!q && (
                <Row active={!value} onClick={() => pick("")}>
                  <span className="text-muted">{placeholder}</span>
                </Row>
              )}
              {list.map((m, i) => (
                <Row key={m.id} active={m.id === value} hot={i === hi} onClick={() => pick(m.id)} onHover={() => setHi(i)}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cx("min-w-0 flex-1 truncate font-mono text-[12.5px]", m.hidden && "text-muted")}>{m.id}</span>
                    {m.hidden && <Icon name="eye" size={12} className="shrink-0 text-dim" />}
                    <ProfileTags list={m.profiles} all={allProfiles.length} />
                  </span>
                  {m.name && m.name !== m.id && <span className="block truncate text-[11.5px] text-muted">{m.name}</span>}
                </Row>
              ))}
              {custom && (
                <Row onClick={() => pick(custom)} hot={list.length === 0}>
                  <span className="text-muted">Dùng </span>
                  <span className="font-mono text-[12.5px]">{custom}</span>
                </Row>
              )}
              {!custom && list.length === 0 && <li className="px-3 py-4 text-center text-xs text-dim">Không có model</li>}
            </ul>
          </div>
        );
      }}
    </Popover>
  );
}

function Row({ children, active, hot, onClick, onHover }: { children: React.ReactNode; active?: boolean; hot?: boolean; onClick: () => void; onHover?: () => void }) {
  return (
    <li role="option" aria-selected={active}>
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={onHover}
        className={cx("press flex w-full items-center gap-2 rounded-[9px] px-2.5 py-1.5 text-left text-sm", hot ? "bg-white/[.07]" : "hover:bg-white/[.05]")}
      >
        <span className="w-4 shrink-0">{active && <Icon name="check" size={15} className="text-accent" />}</span>
        <span className="min-w-0 flex-1">{children}</span>
      </button>
    </li>
  );
}

const EFFORT_LABEL: Record<string, string> = { minimal: "Tối thiểu", low: "Thấp", medium: "Vừa", high: "Cao", xhigh: "Rất cao" };

export function EffortPicker({ efforts, value, onChange, compact }: { efforts: string[]; value: string; onChange: (v: string) => void; compact?: boolean }) {
  if (efforts.length === 0) return null;
  if (compact) {
    return (
      <Select inputSize="sm" aria-label="Mức suy nghĩ" className="w-28 shrink-0" value={efforts.includes(value) ? value : efforts[0]} onChange={(e) => onChange(e.target.value)}>
        {efforts.map((e) => (
          <option key={e} value={e}>
            {EFFORT_LABEL[e] ?? e}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Segmented
      size="sm"
      ariaLabel="Mức suy nghĩ"
      value={efforts.includes(value) ? value : efforts[0]}
      onChange={onChange}
      options={efforts.map((e) => ({ value: e, label: EFFORT_LABEL[e] ?? e, title: e }))}
    />
  );
}
