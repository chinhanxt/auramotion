"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";

const LINKS = [
  { href: "/studio/image", label: "Tạo ảnh" },
  { href: "/studio/video", label: "Tạo video" },
  { href: "/studio/edit", label: "Ghép video" },
  { href: "/library", label: "Thư viện" },
  { href: "/credits", label: "Credit" },
  { href: "/profile", label: "Hồ sơ" },
];

export function UserNav() {
  const pathname = usePathname();
  return (
    <aside className="border-b border-neutral-200 bg-white md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <Link href="/studio/image" className="hidden px-5 py-4 text-lg font-semibold md:block">
        AuraMotion
      </Link>
      <nav className="flex gap-1 overflow-x-auto px-2 py-2 md:flex-col md:px-3">
        {LINKS.map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
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

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ redirectTo: "/login" })}
      className="rounded-md px-2 py-1 text-sm text-neutral-600 hover:bg-neutral-100"
    >
      Đăng xuất
    </button>
  );
}
