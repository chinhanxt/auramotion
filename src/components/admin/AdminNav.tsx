"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Tổng quan" },
  { href: "/admin/users", label: "Người dùng" },
  { href: "/admin/models", label: "Engine" },
  { href: "/admin/credit-rules", label: "Bảng giá Credit" },
  { href: "/admin/plans", label: "Gói dịch vụ" },
  { href: "/admin/presets", label: "Preset" },
  { href: "/admin/music", label: "Nhạc nền" },
  { href: "/admin/jobs", label: "Tác vụ" },
  { href: "/admin/payments", label: "Thanh toán" },
  { href: "/admin/settings", label: "Cài đặt" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <aside className="border-b border-neutral-200 bg-white md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <Link href="/admin" className="hidden px-5 py-4 text-lg font-semibold md:block">
        AuraMotion <span className="text-sm font-normal text-neutral-500">Admin</span>
      </Link>
      <nav className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:px-3">
        {LINKS.map((l) => {
          const active = l.href === "/admin" ? pathname === "/admin" : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                active ? "bg-neutral-900 font-medium text-white" : "text-neutral-700 hover:bg-neutral-100"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
