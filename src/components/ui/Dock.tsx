"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Thanh nổi đáy màn hình (composer, thanh xuất): gắn thẳng vào body để không bị ảnh hưởng bởi hiệu ứng chuyển trang.
export function Dock({ children }: { children: React.ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => setEl(document.body), []);
  if (!el) return null;
  return createPortal(
    <div className="am-layer dock-in pointer-events-none fixed inset-x-0 bottom-[var(--tabbar-h)] z-40 px-2 pb-2 sm:px-4 sm:pb-4">{children}</div>,
    el,
  );
}
