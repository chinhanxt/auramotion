"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Modal, Popover } from "@/components/ui/Overlay";
import { VendorLogo } from "@/components/ui/VendorLogo";
import { VENDOR_LABEL, etaLabel, formatCredit, groupByVendor, modelLabel, planLabel, vendorOf, type CatalogModel } from "@/lib/api-client";

// Bộ chọn model cho người dùng: tên model thật, nhóm theo hãng (Muse, Google, Anthropic, OpenAI…).
// Máy tính: popover; điện thoại: bottom sheet. Chọn bằng chuột hoặc ↑ ↓ Enter.

const BADGE_CLS: Record<string, string> = {
  nhanh: "bg-accent/[.14] text-accent",
  đẹp: "bg-aura2/[.16] text-[#ff9be8]",
  mới: "bg-[#4f8cff]/[.18] text-[#9cc0ff]",
  pro: "bg-[#f5c84b]/[.15] text-[#f5c84b]",
};

export function ModelBadge({ label, className }: { label?: string | null; className?: string }) {
  if (!label?.trim()) return null;
  return (
    <span className={cx("inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] font-semibold tracking-[0.01em]", BADGE_CLS[label.trim().toLowerCase()] ?? "bg-white/[.08] text-fg/80", className)}>
      {label.trim()}
    </span>
  );
}

const vendorName = (v: string) => VENDOR_LABEL[v] ?? (v === "other" ? "Khác" : v.charAt(0).toUpperCase() + v.slice(1));

function useMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(max-width: 767px)");
    const on = () => setM(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

function matches(m: CatalogModel, q: string) {
  return [modelLabel(m), m.name, m.description, m.badge, vendorName(vendorOf(m))].some((x) => x?.toLowerCase().includes(q));
}

export function ModelList({ models, value, onPick, unit, autoFocus = true, className }: { models: CatalogModel[]; value: string; onPick: (m: CatalogModel) => void; unit: string; autoFocus?: boolean; className?: string }) {
  const [q, setQ] = useState("");
  const uid = useId();
  const search = models.length > 8;
  const groups = useMemo(() => groupByVendor(q.trim() ? models.filter((m) => matches(m, q.trim().toLowerCase())) : models), [models, q]);
  const flat = useMemo(() => groups.flatMap(([, l]) => l), [groups]);
  const [active, setActive] = useState(() => Math.max(0, flat.findIndex((m) => m.id === value)));
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => (search ? input.current : list.current)?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, [autoFocus, search]);
  useEffect(() => setActive((a) => (a >= flat.length ? Math.max(0, flat.length - 1) : a)), [flat.length]);
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);
  // Mở lần đầu: cuộn tới model đang chọn.
  useEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "center" });
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    if (!flat.length) return;
    const move = (d: number) => (e.preventDefault(), setActive((a) => (a + d + flat.length) % flat.length));
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "Home") (e.preventDefault(), setActive(0));
    else if (e.key === "End") (e.preventDefault(), setActive(flat.length - 1));
    else if (e.key === "Enter") {
      e.preventDefault();
      const m = flat[active];
      if (m && !m.locked) onPick(m);
    }
  };

  let i = -1;
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      {search && (
        <div className="relative shrink-0 px-1 pt-1 pb-1.5">
          <Icon name="search" size={15} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-[60%] text-dim" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setActive(0))}
            onKeyDown={onKey}
            placeholder="Tìm model…"
            aria-label="Tìm model"
            aria-controls={`${uid}-list`}
            aria-activedescendant={flat[active] ? `${uid}-${active}` : undefined}
            className="h-9 w-full rounded-[10px] bg-white/[.05] pr-2 pl-9 text-[13.5px] !outline-none placeholder:text-dim focus:bg-white/[.08] focus:shadow-[inset_0_0_0_1px_rgba(255,255,255,.12)]"
          />
        </div>
      )}
      <div
        ref={list}
        id={`${uid}-list`}
        role="listbox"
        aria-label="Model"
        tabIndex={search ? -1 : 0}
        onKeyDown={search ? undefined : onKey}
        aria-activedescendant={!search && flat[active] ? `${uid}-${active}` : undefined}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain !outline-none"
      >
        {groups.map(([vendor, items], gi) => (
          <div key={vendor} role="group" aria-label={vendorName(vendor)} className={cx(gi > 0 && "mt-1")}>
            <p className="sticky top-0 z-[1] flex items-center gap-1.5 bg-s2/95 px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-[0.07em] text-dim uppercase backdrop-blur-sm">
              <VendorLogo vendor={vendor} size={14} />
              {vendorName(vendor)}
              <span className="font-medium text-dim/70 tabular-nums">{items.length}</span>
            </p>
            {items.map((m) => {
              i++;
              const idx = i;
              const sel = m.id === value;
              const eta = etaLabel(m);
              return (
                <div
                  key={m.id}
                  id={`${uid}-${idx}`}
                  data-i={idx}
                  role="option"
                  aria-selected={sel}
                  aria-disabled={m.locked || undefined}
                  onMouseMove={() => active !== idx && setActive(idx)}
                  onClick={() => !m.locked && onPick(m)}
                  className={cx(
                    "group relative flex cursor-pointer items-center gap-3 rounded-[12px] px-2.5 py-2.5 transition-[background-color,box-shadow] duration-150",
                    sel ? "bg-white/[.07] shadow-[inset_0_0_0_1px_rgba(212,255,58,.22)]" : idx === active ? "bg-white/[.05]" : "",
                    m.locked && "cursor-not-allowed",
                  )}
                >
                  <VendorLogo vendor={vendorOf(m)} size={34} className={cx("transition-transform duration-200 ease-[var(--ease-spring)]", idx === active && !m.locked && "scale-[1.04]", m.locked && "opacity-50 grayscale-[.4]")} />
                  <span className={cx("min-w-0 flex-1", m.locked && "opacity-60")}>
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-semibold text-fg">{modelLabel(m)}</span>
                      <ModelBadge label={m.badge} />
                    </span>
                    {m.description?.trim() && <span className="mt-0.5 block truncate text-[12px] text-muted">{m.description}</span>}
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-right">
                    {m.locked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f5c84b]/[.12] px-2 py-0.5 text-[11px] font-semibold text-[#f5c84b]">
                        <Icon name="lock" size={11} strokeWidth={2} />
                        {planLabel(m.minPlanRank)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-fg/90 tabular-nums">
                        <Icon name="coin" size={13} className="text-[#f5c84b]" />
                        {formatCredit(m.baseCost)}
                        <span className="font-normal text-dim">/{unit}</span>
                      </span>
                    )}
                    {eta && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-dim tabular-nums">
                        <Icon name="clock" size={11} />
                        {eta}
                      </span>
                    )}
                  </span>
                  <span
                    className={cx(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-[transform,opacity,background-color] duration-200 ease-[var(--ease-spring)]",
                      sel ? "scale-100 bg-accent text-accent-ink opacity-100" : "scale-50 opacity-0",
                    )}
                    aria-hidden="true"
                  >
                    <Icon name="check" size={12} strokeWidth={2.6} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        {flat.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-dim">Không có model khớp</p>}
      </div>
    </div>
  );
}

function ChipFace({ m, interactive }: { m?: CatalogModel; interactive: boolean }) {
  return (
    <>
      {m ? <VendorLogo vendor={vendorOf(m)} size={20} /> : <Icon name="cpu" size={16} />}
      <span className="max-w-40 min-w-0 truncate max-md:max-w-none">{m ? modelLabel(m) : "Model"}</span>
      {interactive && <Icon name="chevronDown" size={14} className="shrink-0 text-muted" />}
    </>
  );
}

const CHIP = "press inline-flex h-9 min-w-0 items-center gap-1.5 rounded-[11px] pr-2.5 pl-1.5 text-[13px] font-medium whitespace-nowrap md:shrink-0 max-md:flex-1";

export function ModelPicker({ models, value, onChange, unit }: { models: CatalogModel[]; value: string; onChange: (m: CatalogModel) => void; unit: string }) {
  const sel = models.find((m) => m.id === value);
  const mobile = useMobile();
  const [open, setOpen] = useState(false);
  const pick = (m: CatalogModel) => {
    onChange(m);
    setOpen(false);
  };

  if (models.length <= 1 && sel) {
    return (
      <span className="inline-flex h-9 shrink-0 items-center gap-1.5 px-1 text-[13px] font-medium text-fg/85" data-tip="Model">
        <ChipFace m={sel} interactive={false} />
      </span>
    );
  }

  const chipCls = cx(CHIP, open ? "bg-white/[.1] text-fg" : "bg-white/[.04] text-fg/85 hover:bg-white/[.08] hover:text-fg");

  if (mobile) {
    return (
      <>
        <button type="button" className={chipCls} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label={`Model: ${sel ? modelLabel(sel) : "chưa chọn"}`}>
          <ChipFace m={sel} interactive />
        </button>
        <Modal open={open} onClose={() => setOpen(false)} title="Chọn model" size="sm">
          <ModelList models={models} value={value} onPick={pick} unit={unit} autoFocus={false} className="max-h-[68dvh]" />
        </Modal>
      </>
    );
  }

  return (
    <Popover
      side="top"
      open={open}
      onOpenChange={setOpen}
      className="w-[400px] max-w-[calc(100vw-16px)]"
      trigger={({ toggle, ref, ...aria }) => (
        <button ref={ref} type="button" onClick={toggle} {...aria} data-tip="Model" className={chipCls}>
          <ChipFace m={sel} interactive />
        </button>
      )}
    >
      <ModelList models={models} value={value} onPick={pick} unit={unit} className="max-h-[min(62vh,540px)]" />
    </Popover>
  );
}
