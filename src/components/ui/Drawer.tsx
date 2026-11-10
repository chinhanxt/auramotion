"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { cx } from "./cx";
import { useFocusTrap, usePresence } from "./Overlay";

// Khóa cuộn bằng <html> (Modal khóa <body>): mở ConfirmDialog trên drawer rồi đóng vẫn giữ khóa.
let drawerLocks = 0;
function lockRoot() {
  if (drawerLocks++ === 0) document.documentElement.style.overflow = "hidden";
  return () => {
    if (--drawerLocks === 0) document.documentElement.style.overflow = "";
  };
}

// Ngăn trượt từ cạnh màn hình: trình sửa chi tiết (phải) hoặc menu điều hướng mobile (trái).
export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  side = "right",
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  side?: "left" | "right";
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const { mounted, closing } = usePresence(open, 200);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, open && mounted);

  useEffect(() => {
    if (!open) return;
    const unlock = lockRoot();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      unlock();
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-xl", lg: "sm:max-w-3xl", xl: "sm:max-w-5xl" }[size];

  return createPortal(
    <div className="am-layer fixed inset-0 z-[86]" data-closing={closing || undefined}>
      <div className="overlay-backdrop absolute inset-0 bg-black/60 backdrop-blur-[4px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        data-side={side}
        className={cx(
          "drawer-panel absolute inset-y-0 flex w-full flex-col bg-s1 pt-[var(--safe-t)] outline-none shadow-[0_0_0_1px_var(--color-line2),0_40px_120px_-20px_rgba(0,0,0,.9)]",
          side === "right" ? "right-0" : "left-0",
          side === "left" ? "max-w-[300px]" : width,
          className,
        )}
      >
        {title && (
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="truncate text-[17px] font-semibold tracking-tight">
                {title}
              </h2>
              {subtitle && <div className="mt-0.5 truncate text-xs text-muted">{subtitle}</div>}
            </div>
            <IconButton icon="close" label="Đóng" size="sm" tip={false} onClick={onClose} />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="shrink-0 border-t border-line px-5 py-3 pb-[calc(12px+var(--safe-b))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
