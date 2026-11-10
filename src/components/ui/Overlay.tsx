"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import { IconButton } from "./Button";

const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Giữ focus trong phần tử khi mở; trả focus về chỗ cũ khi đóng.
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const root = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus({ preventScroll: true });
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return e.preventDefault();
      const a = items[0];
      const z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    }
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      prev?.focus?.({ preventScroll: true });
    };
  }, [active, ref]);
}

// Giữ phần tử thêm một nhịp sau khi đóng để chạy hiệu ứng ra.
export function usePresence(open: boolean, ms = 200) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, ms);
    return () => clearTimeout(t);
  }, [open, ms, mounted]);
  return { mounted, closing };
}

let lockCount = 0;
function lockScroll() {
  if (lockCount++ === 0) {
    const w = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (w > 0) document.body.style.paddingRight = `${w}px`;
  }
  return () => {
    if (--lockCount === 0) {
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
    }
  };
}

export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  sheet = true,
  bare = false,
  className,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  sheet?: boolean;
  bare?: boolean;
  className?: string;
  footer?: React.ReactNode;
}) {
  const { mounted, closing } = usePresence(open);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, open && mounted);

  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-3xl", xl: "sm:max-w-6xl", full: "sm:max-w-[min(1600px,96vw)]" }[size];

  return createPortal(
    <div className="am-layer fixed inset-0 z-[88]" data-closing={closing || undefined}>
      <div className="overlay-backdrop absolute inset-0 bg-black/70 backdrop-blur-[6px]" onClick={onClose} />
      <div className={cx("pointer-events-none absolute inset-0 flex justify-center", sheet ? "items-end sm:items-center sm:p-6" : "items-center p-3 sm:p-6")}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          tabIndex={-1}
          className={cx(
            "pointer-events-auto relative flex max-h-[92dvh] w-full flex-col outline-none",
            !bare && "overflow-hidden bg-s1 shadow-[0_0_0_1px_var(--color-line2),0_40px_120px_-20px_rgba(0,0,0,.9)]",
            sheet ? "modal-sheet rounded-t-m4 sm:rounded-m4" : "modal-pop rounded-m4",
            width,
            className,
          )}
        >
          {sheet && !bare && <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" aria-hidden="true" />}
          {title && (
            <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
              <h2 id={titleId} className="text-[17px] font-semibold tracking-tight">
                {title}
              </h2>
              <IconButton icon="close" label="Đóng" size="sm" tip={false} onClick={onClose} />
            </div>
          )}
          <div className={cx("min-h-0 flex-1 overflow-y-auto", !bare && "px-5 pb-5 sm:px-6 sm:pb-6")}>{children}</div>
          {footer && <div className="shrink-0 border-t border-line px-5 py-3 pb-[calc(12px+var(--safe-b))] sm:px-6 sm:pb-3">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Xác nhận",
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title}>
      {body && <div className="text-sm text-muted">{body}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="press h-10 rounded-m1 px-4 text-sm font-medium text-fg/80 hover:bg-white/[.06]">
          Hủy
        </button>
        <button
          type="button"
          data-autofocus
          onClick={onConfirm}
          disabled={busy}
          className={cx(
            "press h-10 rounded-m1 px-4 text-sm font-semibold disabled:opacity-50",
            danger ? "bg-danger text-white hover:bg-[#ff7380]" : "bg-accent text-accent-ink",
          )}
        >
          {busy ? "Đang xử lý..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// Menu thả xuống / thả lên, gắn với nút bấm.
export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
  open: controlled,
  onOpenChange,
}: {
  trigger: (p: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement>; "aria-expanded": boolean; "aria-haspopup": "menu" }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end" | "center";
  side?: "top" | "bottom";
  className?: string;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = controlled ?? inner;
  const setOpen = useCallback((v: boolean) => (onOpenChange ? onOpenChange(v) : setInner(v)), [onOpenChange]);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const { mounted, closing } = usePresence(open, 140);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const close = () => setOpen(false);
  return (
    <div ref={wrap} className="relative inline-flex">
      {trigger({ open, toggle: () => setOpen(!open), ref: btn, "aria-expanded": open, "aria-haspopup": "menu" })}
      {mounted && (
        <div
          data-closing={closing || undefined}
          className={cx(
            "popover-panel absolute z-[70] min-w-48 rounded-m2 bg-s2 p-1.5 shadow-[0_0_0_1px_var(--color-line2),0_24px_60px_-12px_rgba(0,0,0,.85)]",
            side === "top" ? "bottom-[calc(100%+8px)] origin-bottom" : "top-[calc(100%+8px)] origin-top",
            align === "end" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  children,
  onClick,
  href,
  active,
  danger,
  disabled,
  hint,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  hint?: React.ReactNode;
}) {
  const cls = cx(
    "press flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm disabled:opacity-40",
    danger ? "text-danger hover:bg-danger/10" : active ? "bg-white/[.08] text-fg" : "text-fg/85 hover:bg-white/[.06] hover:text-fg",
  );
  const inner = (
    <>
      {icon && <span className="flex shrink-0 text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-xs text-muted">{hint}</span>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cls} role="menuitem" onClick={onClick}>
        {inner}
      </Link>
    );
  }
  return (
    <button type="button" role="menuitem" className={cls} onClick={onClick} disabled={disabled}>
      {inner}
    </button>
  );
}
