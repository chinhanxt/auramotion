"use client";

import { ToastProvider } from "@/components/ui/Toast";

// Trang công khai (landing, bảng giá): nền tối + toast, không mở kết nối realtime.
export function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="am">{children}</div>
    </ToastProvider>
  );
}
