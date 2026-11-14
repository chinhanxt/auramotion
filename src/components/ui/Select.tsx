"use client";

import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { inputClass } from "./Field";
import { Icon } from "./Icon";

// Ô chọn dạng danh sách tùy chỉnh (nền tối, tìm kiếm khi dài, bàn phím, tự lật lên khi hết chỗ).
// Giữ nguyên cách dùng cũ: <Select value onChange={(e) => e.target.value}> với <option> / <optgroup> làm con.

type Opt = { value: string; label: React.ReactNode; text: string; disabled?: boolean; group?: string };

function textOf(n: React.ReactNode): string {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: React.ReactNode }).children);
  return "";
}

function collect(children: React.ReactNode, group?: string, out: Opt[] = []): Opt[] {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const p = c.props as { value?: string | number; children?: React.ReactNode; disabled?: boolean; label?: string };
    if (c.type === "option") {
      const text = textOf(p.children);
      out.push({ value: p.value === undefined ? text : String(p.value), label: p.children, text, disabled: p.disabled, group });
    } else if (c.type === "optgroup") collect(p.children, p.label, out);
    else if (p.children) collect(p.children, group, out);
  });
  return out;
}

type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "onChange" | "value" | "children" | "size"> & {
  value?: string | number | readonly string[];
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children?: React.ReactNode;
  inputSize?: "sm" | "md";
  placeholder?: string;
};

const SEARCH_FROM = 9;

export function Select({ className, inputSize = "md", children, value, onChange, disabled, placeholder, id, name, title, ...rest }: Props) {
  const opts = useMemo(() => collect(children), [children]);
  const cur = value === undefined || Array.isArray(value) ? "" : String(value);
  const sel = opts.find((o) => o.value === cur);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<React.CSSProperties | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const listId = useId();
  const searchable = opts.length >= SEARCH_FROM;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? opts.filter((o) => o.text.toLowerCase().includes(s) || o.value.toLowerCase().includes(s)) : opts;
  }, [opts, q]);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setQ("");
    if (refocus) btn.current?.focus();
  }, []);

  const pick = useCallback(
    (o: Opt) => {
      if (o.disabled) return;
      close();
      if (o.value !== cur) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } } as unknown as React.ChangeEvent<HTMLSelectElement>);
    },
    [close, cur, name, onChange],
  );

  // Định vị fixed theo nút; hết chỗ phía dưới thì lật lên.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const vh = window.innerHeight;
      const below = vh - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 220 && above > below;
      const width = Math.max(r.width, 200);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setPos({ left, width, maxHeight: Math.max(160, Math.min(360, up ? above : below)), ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) close(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const i = shown.findIndex((o) => o.value === cur);
    setActive(i >= 0 ? i : 0);
    if (searchable) requestAnimationFrame(() => search.current?.focus({ preventScroll: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open, pos]);

  function onKey(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    const n = shown.length;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(n - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(Math.max(0, n - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    } else if (e.key === "Tab") close(false);
  }

  let lastGroup: string | undefined;
  return (
    <span className={cx("relative block", className)}>
      <button
        ref={btn}
        id={id}
        type="button"
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={rest["aria-label"]}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={cx(inputClass, "flex w-full cursor-pointer items-center gap-2 pr-9 text-left disabled:cursor-not-allowed disabled:opacity-50", inputSize === "sm" ? "h-9 text-[13px]" : "h-11")}
      >
        <span className={cx("min-w-0 flex-1 truncate", !sel && "text-dim")}>{sel ? sel.label : (placeholder ?? "Chọn…")}</span>
      </button>
      <Icon name="chevronDown" size={16} className={cx("pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted transition-transform duration-200", open && "rotate-180")} />
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            style={pos}
            onKeyDown={onKey}
            className="am-layer popover-panel fixed z-[95] flex flex-col overflow-hidden rounded-m2 bg-s2 text-fg shadow-[0_0_0_1px_var(--color-line2),0_24px_60px_-12px_rgba(0,0,0,.85)]"
          >
            {searchable && (
              <div className="shrink-0 border-b border-line p-1.5">
                <div className="flex items-center gap-2 rounded-m1 bg-white/[.05] px-2.5">
                  <Icon name="search" size={14} className="shrink-0 text-muted" />
                  <input
                    ref={search}
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value);
                      setActive(0);
                    }}
                    placeholder="Tìm…"
                    aria-label="Tìm trong danh sách"
                    className="h-8 w-full bg-transparent text-[13px] text-fg outline-none! placeholder:text-dim"
                  />
                </div>
              </div>
            )}
            <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
              {shown.length === 0 && <li className="px-3 py-3 text-center text-[13px] text-dim">Không có kết quả</li>}
              {shown.map((o, i) => {
                const head = o.group && o.group !== lastGroup ? o.group : null;
                lastGroup = o.group;
                const selected = o.value === cur;
                return (
                  <li key={`${o.value}:${i}`} role="presentation">
                    {head && <p className="px-2.5 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-dim uppercase">{head}</p>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-i={i}
                      disabled={o.disabled}
                      tabIndex={-1}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => pick(o)}
                      className={cx(
                        "flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] disabled:opacity-40",
                        i === active ? "bg-white/[.08] text-fg" : "text-fg/85",
                        selected && "font-semibold",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {selected && <Icon name="check" size={14} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
      {name && <input type="hidden" name={name} value={cur} />}
    </span>
  );
}
