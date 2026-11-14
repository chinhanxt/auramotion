"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { AuraDot } from "@/components/layout/Logo";
import { Avatar, Kbd } from "@/components/ui/Bits";
import { IconButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { inputClass } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/Icon";
import { MenuItem, Modal, Popover } from "@/components/ui/Overlay";
import { ToastProvider } from "@/components/ui/Toast";

type NavItem = { href: string; label: string; icon: IconName; keywords?: string };
type NavGroup = { title: string | null; items: NavItem[] };

export const ADMIN_NAV: NavGroup[] = [
  { title: null, items: [{ href: "/admin", label: "Tổng quan", icon: "gauge", keywords: "dashboard" }] },
  {
    title: "Nội dung",
    items: [
      { href: "/admin/skills", label: "Skill", icon: "wand", keywords: "prompt template" },
      { href: "/admin/presets", label: "Theme & Camera", icon: "palette", keywords: "preset style" },
      { href: "/admin/stories", label: "Story", icon: "story", keywords: "kịch bản" },
      { href: "/admin/featured", label: "Nổi bật", icon: "star", keywords: "explore featured" },
    ],
  },
  {
    title: "Engine",
    items: [
      { href: "/admin/models", label: "Model", icon: "cpu", keywords: "engine" },
      { href: "/admin/muse", label: "Muse", icon: "bolt", keywords: "tài khoản cookie" },
      { href: "/admin/ai", label: "AI & Model", icon: "sparkle", keywords: "google openai gemini claude gateway tài khoản model" },
      { href: "/admin/flow", label: "Luồng xử lý", icon: "route", keywords: "pipeline flow sơ đồ trace" },
      { href: "/admin/queues", label: "Hàng đợi", icon: "layers", keywords: "queue bullmq" },
      { href: "/admin/jobs", label: "Tác vụ", icon: "list", keywords: "job" },
    ],
  },
  {
    title: "Kinh doanh",
    items: [
      { href: "/admin/users", label: "Người dùng", icon: "users", keywords: "user" },
      { href: "/admin/plans", label: "Gói", icon: "tag", keywords: "plan" },
      { href: "/admin/credit-rules", label: "Giá Credit", icon: "coin", keywords: "pricing" },
      { href: "/admin/payments", label: "Thanh toán", icon: "card", keywords: "payment" },
    ],
  },
  {
    title: "Hệ thống",
    items: [
      { href: "/admin/music", label: "Nhạc", icon: "music", keywords: "music" },
      { href: "/admin/settings", label: "Cài đặt", icon: "gear", keywords: "settings bảo trì" },
    ],
  },
];

const ALL_ITEMS = ADMIN_NAV.flatMap((g) => g.items);

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export type AdminUser = { name: string; email: string; avatarUrl: string | null };

function Brand() {
  return (
    <Link href="/admin" className="press flex items-center gap-2 text-[16px] font-bold tracking-[-0.04em]">
      <AuraDot />
      AuraMotion
      <span className="rounded-md bg-white/[.07] px-1.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-muted uppercase">Admin</span>
    </Link>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Quản trị" className="space-y-5">
      {ADMIN_NAV.map((g, gi) => (
        <div key={gi}>
          {g.title && <p className="t-label mb-1.5 px-3 text-[10px]">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "press relative flex h-9 items-center gap-2.5 rounded-m1 px-3 text-[13.5px] font-medium",
                      active ? "bg-white/[.08] text-fg" : "text-muted hover:bg-white/[.04] hover:text-fg",
                    )}
                  >
                    {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full" style={{ background: "var(--aura)" }} />}
                    <Icon name={n.icon} size={17} className={active ? "text-fg" : "text-dim"} />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-line bg-[#09090b] lg:flex">
      <div className="flex h-14 shrink-0 items-center px-5">
        <Brand />
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2.5 pt-2 pb-4">
        <NavList />
      </div>
      <div className="shrink-0 border-t border-line p-2.5">
        <Link href="/studio/image" className="press flex h-9 items-center gap-2.5 rounded-m1 px-3 text-[13px] text-muted hover:bg-white/[.04] hover:text-fg">
          <Icon name="arrowLeft" size={16} />
          Về app
        </Link>
      </div>
    </aside>
  );
}

function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
    }
  }, [open]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const pages = ALL_ITEMS.filter((n) => !term || `${n.label} ${n.keywords ?? ""}`.toLowerCase().includes(term)).map((n) => ({
      key: n.href,
      label: n.label,
      icon: n.icon,
      hint: "Trang",
      href: n.href,
    }));
    const extra = term
      ? [
          { key: "u", label: `Người dùng “${q.trim()}”`, icon: "users" as IconName, hint: "Tìm", href: `/admin/users?search=${encodeURIComponent(q.trim())}` },
          { key: "j", label: `Tác vụ của “${q.trim()}”`, icon: "list" as IconName, hint: "Tìm", href: `/admin/jobs?user=${encodeURIComponent(q.trim())}` },
          { key: "p", label: `Thanh toán “${q.trim()}”`, icon: "card" as IconName, hint: "Tìm", href: `/admin/payments?search=${encodeURIComponent(q.trim())}` },
        ]
      : [];
    return [...pages, ...extra];
  }, [q]);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <Modal open={open} onClose={onClose} size="md" sheet={false} bare className="overflow-hidden bg-s1 shadow-[0_0_0_1px_var(--color-line2),0_40px_120px_-20px_rgba(0,0,0,.9)] sm:mt-[-20vh]">
      <div className="flex items-center gap-2 border-b border-line px-4">
        <Icon name="search" size={18} className="text-muted" />
        <input
          data-autofocus
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(results.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter" && results[sel]) go(results[sel].href);
          }}
          placeholder="Đi tới trang, tìm email, mã đơn…"
          className={cx(inputClass, "h-13 bg-transparent px-1 text-[15px] shadow-none outline-none! ring-0 hover:bg-transparent focus:bg-transparent focus:shadow-none focus-visible:outline-none!")}
        />
        <Kbd>Esc</Kbd>
      </div>
      <ul className="max-h-[50dvh] overflow-y-auto p-1.5">
        {results.map((r, i) => (
          <li key={r.key}>
            <button
              type="button"
              onMouseEnter={() => setSel(i)}
              onClick={() => go(r.href)}
              className={cx("flex w-full items-center gap-3 rounded-m1 px-3 py-2.5 text-left text-sm", i === sel ? "bg-white/[.08] text-fg" : "text-fg/80")}
            >
              <Icon name={r.icon} size={17} className="text-muted" />
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              <span className="text-xs text-dim">{r.hint}</span>
            </button>
          </li>
        ))}
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Không có kết quả</li>}
      </ul>
    </Modal>
  );
}

function TopBar({ admin, onMenu, onSearch }: { admin: AdminUser; onMenu: () => void; onSearch: () => void }) {
  const pathname = usePathname();
  const current = [...ALL_ITEMS].sort((a, b) => b.href.length - a.href.length).find((n) => isActive(pathname, n.href));
  return (
    <header className="glass sticky top-0 z-30 border-b border-line pt-[var(--safe-t)]">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-5 lg:px-8">
        <IconButton icon="menu" label="Menu" tip={false} className="lg:hidden" onClick={onMenu} />
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold lg:hidden">
          {current && <Icon name={current.icon} size={16} className="shrink-0 text-muted" />}
          <span className="truncate">{current?.label ?? "Quản trị"}</span>
        </span>
        <button
          type="button"
          onClick={onSearch}
          className="press ml-auto flex h-9 items-center gap-2 rounded-m1 bg-white/[.04] px-3 text-[13px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[.07] hover:text-fg lg:ml-0 lg:w-80"
          aria-label="Tìm nhanh"
        >
          <Icon name="search" size={16} />
          <span className="hidden sm:inline">Tìm nhanh</span>
          <span className="ml-auto hidden items-center gap-1 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="flex items-center gap-1.5 lg:ml-auto">
          <Link
            href="/studio/image"
            className="press hidden h-9 items-center gap-1.5 rounded-m1 px-3 text-[13px] font-medium text-muted hover:bg-white/[.06] hover:text-fg sm:flex"
          >
            <Icon name="external" size={15} />
            Mở app
          </Link>
          <Popover
            align="end"
            className="w-64"
            trigger={({ toggle, ref, ...aria }) => (
              <button ref={ref} type="button" onClick={toggle} aria-label="Tài khoản" className="press rounded-full ring-1 ring-white/10 hover:ring-white/25" {...aria}>
                <Avatar name={admin.name} url={admin.avatarUrl} size={32} />
              </button>
            )}
          >
            {(close) => (
              <div onClick={close}>
                <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
                  <Avatar name={admin.name} url={admin.avatarUrl} size={36} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{admin.name}</p>
                    <p className="truncate text-xs text-muted">{admin.email}</p>
                  </div>
                </div>
                <div className="my-1 h-px bg-line" />
                <MenuItem href="/studio/image" icon={<Icon name="sparkle" size={17} />}>
                  Về app
                </MenuItem>
                <MenuItem href="/profile" icon={<Icon name="user" size={17} />}>
                  Hồ sơ
                </MenuItem>
                <div className="my-1 h-px bg-line" />
                <MenuItem icon={<Icon name="logout" size={17} />} onClick={() => signOut({ redirectTo: "/login" })}>
                  Đăng xuất
                </MenuItem>
              </div>
            )}
          </Popover>
        </div>
      </div>
    </header>
  );
}

export function AdminShell({ admin, children }: { admin: AdminUser; children: React.ReactNode }) {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ToastProvider>
      <div className="am admin-shell">
        <Sidebar />
        <div className="min-w-0 lg:pl-[232px]">
          <TopBar admin={admin} onMenu={() => setMenu(true)} onSearch={() => setSearch(true)} />
          <main className="w-full min-w-0 px-3 pt-5 pb-20 sm:px-5 lg:px-8 lg:pt-7">{children}</main>
        </div>
        <Drawer open={menu} onClose={() => setMenu(false)} side="left">
          <div className="flex h-14 items-center justify-between px-5">
            <Brand />
            <IconButton icon="close" label="Đóng" size="sm" tip={false} onClick={() => setMenu(false)} />
          </div>
          <div className="px-2.5 pb-6">
            <NavList onNavigate={() => setMenu(false)} />
            <Link
              href="/studio/image"
              className="press mt-5 flex h-9 items-center gap-2.5 rounded-m1 px-3 text-[13px] text-muted hover:bg-white/[.04] hover:text-fg"
            >
              <Icon name="arrowLeft" size={16} />
              Về app
            </Link>
          </div>
        </Drawer>
        <CommandPalette open={search} onClose={() => setSearch(false)} />
      </div>
    </ToastProvider>
  );
}
