"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AuraBar, Badge, Empty, type Tone } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { inputClass } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";

// ───────── Khung trang ─────────

export function PageHeader({
  icon,
  title,
  sub,
  actions,
  back,
}: {
  icon?: IconName;
  title: React.ReactNode;
  sub?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="press mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
            <Icon name="chevronLeft" size={15} />
            {back.label}
          </Link>
        )}
        <h1 className="flex items-center gap-3 text-[22px] leading-tight font-bold tracking-[-0.03em] sm:text-[26px]">
          {icon && (
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-m1 bg-s2 hairline">
              <span className="absolute inset-0 rounded-m1 opacity-30 blur-md" style={{ background: "var(--aura)" }} />
              <Icon name={icon} size={18} className="relative" />
            </span>
          )}
          <span className="min-w-0 truncate">{title}</span>
        </h1>
        {sub && <div className="mt-1.5 text-[13px] text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  pad = true,
}: {
  title?: React.ReactNode;
  icon?: IconName;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  pad?: boolean;
}) {
  return (
    <section className={cx("min-w-0 rounded-m3 bg-s1 hairline", className)}>
      {(title || actions) && (
        <div className="flex min-h-12 items-center justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            {icon && <Icon name={icon} size={16} className="shrink-0 text-muted" />}
            <span className="truncate">{title}</span>
          </h2>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      <div className={cx(pad && "p-4 sm:p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

// Thẻ số liệu (KPI).
export function Stat({
  label,
  value,
  icon,
  hint,
  tone,
  i = 0,
  href,
}: {
  label: string;
  value: React.ReactNode;
  icon?: IconName;
  hint?: React.ReactNode;
  tone?: "ok" | "warn" | "danger" | "accent";
  i?: number;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-muted">{label}</p>
        {icon && <Icon name={icon} size={16} className="shrink-0 text-dim" />}
      </div>
      <p
        className={cx(
          "mt-2 truncate text-[26px] leading-none font-bold tracking-[-0.03em] tabular-nums",
          tone === "ok" && "text-ok",
          tone === "warn" && "text-warn",
          tone === "danger" && "text-danger",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </p>
      {hint && <div className="mt-1.5 truncate text-xs text-dim">{hint}</div>}
    </>
  );
  const cls = "reveal block min-w-0 rounded-m3 bg-s1 p-4 hairline";
  const style = { "--i": i } as React.CSSProperties;
  return href ? (
    <Link href={href} className={cx(cls, "press hover:bg-s2")} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

export function Dot({ tone = "neutral", pulse }: { tone?: "ok" | "warn" | "danger" | "neutral" | "info"; pulse?: boolean }) {
  const color = { ok: "bg-ok", warn: "bg-warn", danger: "bg-danger", neutral: "bg-dim", info: "bg-aura1" }[tone];
  return (
    <span className="relative inline-flex h-2 w-2 shrink-0" aria-hidden="true">
      {pulse && <span className={cx("absolute inset-0 animate-ping rounded-full opacity-60", color)} />}
      <span className={cx("relative h-2 w-2 rounded-full", color)} />
    </span>
  );
}

// Thanh "đang dùng / giới hạn".
export function Meter({ used, limit, label }: { used: number; limit: number; label?: React.ReactNode }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const tone = limit > 0 && used >= limit ? "bg-warn" : "bg-accent";
  return (
    <div className="min-w-0">
      {label !== undefined && (
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="text-muted">{label}</span>
          <span className="font-semibold tabular-nums">
            {used}
            <span className="text-dim">/{limit}</span>
          </span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[.07]">
        <div className={cx("h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out)]", tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Progress({ value }: { value?: number | null }) {
  return <AuraBar value={value} className="w-full" />;
}

// Cặp nhãn – giá trị.
export function KV({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cx("grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 truncate text-right sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("font-mono text-[12px] text-fg/80", className)}>{children}</span>;
}

export function Tag({ tone, children, dot }: { tone?: Tone; children: React.ReactNode; dot?: boolean }) {
  return (
    <Badge tone={tone} dot={dot}>
      {children}
    </Badge>
  );
}

// ───────── Bảng → thẻ trên màn hẹp ─────────

export type Col<T> = {
  key: string;
  label: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
  align?: "right" | "center";
  // Trên mobile: "title" = dòng tiêu đề thẻ, "hide" = ẩn, "actions" = hàng nút cuối thẻ; mặc định hiện kèm nhãn.
  mobile?: "title" | "hide" | "actions" | "full";
  width?: string;
};

export function DataList<T>({
  rows,
  cols,
  rowKey,
  empty,
  onRowClick,
  dense,
  className,
}: {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  dense?: boolean;
  className?: string;
}) {
  if (rows.length === 0) {
    return <div className={cx("rounded-m3 bg-s1 hairline", className)}>{empty ?? <Empty icon="list" title="Trống" className="py-12" />}</div>;
  }
  const title = cols.find((c) => c.mobile === "title");
  const actions = cols.filter((c) => c.mobile === "actions");
  const rest = cols.filter((c) => c !== title && c.mobile !== "hide" && c.mobile !== "actions");
  return (
    <div className={cx("min-w-0", className)}>
      {/* md+: bảng */}
      <div className="hidden overflow-x-auto rounded-m3 bg-s1 hairline md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {cols.map((c) => (
                <th
                  key={c.key}
                  style={c.width ? { width: c.width } : undefined}
                  className={cx(
                    "px-4 py-2.5 text-[11px] font-semibold tracking-[0.06em] whitespace-nowrap text-muted uppercase",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cx("reveal transition-colors duration-150", onRowClick && "cursor-pointer hover:bg-white/[.03]")}
                style={{ "--i": i } as React.CSSProperties}
              >
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={cx(
                      "px-4 align-middle",
                      dense ? "py-2" : "py-3",
                      c.align === "right" && "text-right",
                      c.align === "center" && "text-center",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* < md: thẻ */}
      <ul className="space-y-2 md:hidden">
        {rows.map((row, i) => (
          <li
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cx("reveal rounded-m2 bg-s1 p-3.5 hairline", onRowClick && "press cursor-pointer active:bg-s2")}
            style={{ "--i": i } as React.CSSProperties}
          >
            {title && <div className="mb-2 min-w-0 text-[15px] font-semibold">{title.cell(row)}</div>}
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-[13px]">
              {rest.map((c) =>
                c.mobile === "full" ? (
                  <dd key={c.key} className="col-span-2 min-w-0">
                    {c.cell(row)}
                  </dd>
                ) : (
                  <div key={c.key} className="contents">
                    <dt className="text-xs text-muted">{c.label}</dt>
                    <dd className="min-w-0 text-right">{c.cell(row)}</dd>
                  </div>
                ),
              )}
            </dl>
            {actions.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3" onClick={(e) => e.stopPropagation()}>
                {actions.map((c) => (
                  <span key={c.key} className="contents">
                    {c.cell(row)}
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────── Lọc + phân trang bằng query string ─────────

function useQueryNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const href = (patch: Record<string, string | undefined>, keepPage = false) => {
    const qs = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) qs.set(k, v);
      else qs.delete(k);
    }
    if (!keepPage && !("page" in patch)) qs.delete("page");
    const s = qs.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  return { params, pending, href, go: (patch: Record<string, string | undefined>) => start(() => router.push(href(patch), { scroll: false })) };
}

export type FilterField =
  | { name: string; type: "search"; placeholder: string; icon?: IconName }
  | { name: string; type: "select"; options: { value: string; label: string }[]; label?: string }
  | { name: string; type: "chips"; options: { value: string; label: string }[] };

export function UrlFilters({ fields, right }: { fields: FilterField[]; right?: React.ReactNode }) {
  const { params, pending, go } = useQueryNav();
  return (
    <div className="relative mb-4">
      <div className="flex flex-wrap items-center gap-2">
        {fields.map((f) =>
          f.type === "search" ? (
            <SearchBox key={f.name} value={params.get(f.name) ?? ""} placeholder={f.placeholder} onCommit={(v) => go({ [f.name]: v || undefined })} />
          ) : f.type === "select" ? (
            <Select
              key={f.name}
              inputSize="sm"
              aria-label={f.label ?? f.name}
              className="w-auto min-w-36"
              value={params.get(f.name) ?? ""}
              onChange={(e) => go({ [f.name]: e.target.value || undefined })}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : (
            <div key={f.name} className="no-scrollbar -mx-1 flex max-w-full gap-1.5 overflow-x-auto px-1">
              {f.options.map((o) => {
                const active = (params.get(f.name) ?? "") === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => go({ [f.name]: o.value || undefined })}
                    className={cx(
                      "press h-8 shrink-0 rounded-full px-3 text-[13px] font-medium whitespace-nowrap",
                      active ? "bg-fg text-bg" : "bg-white/[.05] text-fg/75 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-fg",
                    )}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          ),
        )}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      <div className={cx("absolute inset-x-0 -bottom-2.5 transition-opacity duration-200", pending ? "opacity-100" : "opacity-0")}>
        {pending && <AuraBar />}
      </div>
    </div>
  );
}

export function SearchBox({ value, placeholder, onCommit, className }: { value: string; placeholder: string; onCommit: (v: string) => void; className?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => {
    if (v === value) return;
    const t = setTimeout(() => onCommit(v.trim()), 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v]);
  return (
    <label className={cx("relative block w-full min-w-0 sm:w-72", className)}>
      <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-dim" />
      <input
        type="search"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onCommit(v.trim())}
        className={cx(inputClass, "h-9 pl-9 text-[13px]")}
      />
    </label>
  );
}

export function Pager({ page, total, pageSize }: { page: number; total: number; pageSize: number }) {
  const { href, pending } = useQueryNav();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const btn = "press inline-flex h-8 w-8 items-center justify-center rounded-m1 text-fg/80 shadow-[inset_0_0_0_1px_var(--color-line2)] hover:bg-white/[.06]";
  return (
    <div className={cx("mt-4 flex items-center justify-between gap-3 text-[13px] text-muted transition-opacity", pending && "opacity-60")}>
      <span className="tabular-nums">
        {total.toLocaleString("vi-VN")} mục · {page}/{pages}
      </span>
      <div className="flex gap-1.5">
        {page > 1 ? (
          <Link href={href({ page: String(page - 1) })} className={btn} aria-label="Trang trước" scroll={false}>
            <Icon name="chevronLeft" size={16} />
          </Link>
        ) : (
          <span className={cx(btn, "pointer-events-none opacity-30")}>
            <Icon name="chevronLeft" size={16} />
          </span>
        )}
        {page < pages ? (
          <Link href={href({ page: String(page + 1) })} className={btn} aria-label="Trang sau" scroll={false}>
            <Icon name="chevronRight" size={16} />
          </Link>
        ) : (
          <span className={cx(btn, "pointer-events-none opacity-30")}>
            <Icon name="chevronRight" size={16} />
          </span>
        )}
      </div>
    </div>
  );
}

// ───────── Form ─────────

export function FieldRow({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block min-w-0 space-y-1.5", className)}>
      <span className="block text-[13px] font-medium text-fg/75">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

// Ô số gọn (h-9).
export function NumberInput({
  value,
  onChange,
  step = "any",
  min,
  max,
  className,
  suffix,
  ...rest
}: { value: number | string; onChange: (v: string) => void; step?: string; min?: number; max?: number; className?: string; suffix?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  return (
    <span className={cx("relative block", className)}>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, "h-9 text-[13px] tabular-nums", suffix && "pr-12")}
        {...rest}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-dim">{suffix}</span>}
    </span>
  );
}

export function TextInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(inputClass, "h-9 text-[13px]", className)} {...props} />;
}

export function CodeArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      spellCheck={false}
      className={cx(inputClass, "resize-y bg-black/30 py-2.5 font-mono text-[12.5px] leading-relaxed", className)}
      {...props}
    />
  );
}

// Thanh lưu dính đáy khi form có thay đổi.
export function SaveBar({ dirty, busy, onSave, onReset, label = "Lưu" }: { dirty: boolean; busy?: boolean; onSave: () => void; onReset?: () => void; label?: string }) {
  return (
    <div
      className={cx(
        "flex items-center justify-end gap-2 transition-opacity duration-200",
        dirty ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      aria-hidden={!dirty}
    >
      {onReset && (
        <button type="button" onClick={onReset} className="press h-9 rounded-m1 px-3 text-[13px] text-muted hover:text-fg">
          Hoàn tác
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="press inline-flex h-9 items-center gap-1.5 rounded-m1 bg-accent px-4 text-[13px] font-semibold text-accent-ink disabled:opacity-50"
      >
        <Icon name="check" size={15} strokeWidth={2} />
        {busy ? "Đang lưu..." : label}
      </button>
    </div>
  );
}
