"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import { EventsProvider, useCreditBalance } from "@/components/realtime/Events";
import { Avatar } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { CoinMark, Icon, type IconName } from "@/components/ui/Icon";
import { apiCached, formatCredit } from "@/lib/api-client";
import { MenuItem, Popover } from "@/components/ui/Overlay";
import { ToastProvider } from "@/components/ui/Toast";
import { Logo } from "./Logo";

const NAV: { href: string; label: string; icon: IconName; match?: string }[] = [
  { href: "/explore", label: "Khám phá", icon: "compass" },
  { href: "/studio/image", label: "Ảnh", icon: "image" },
  { href: "/studio/video", label: "Video", icon: "video" },
  { href: "/studio/story", label: "Story", icon: "story" },
  { href: "/studio/edit", label: "Ghép", icon: "cut" },
  { href: "/library", label: "Thư viện", icon: "library" },
];

export type ShellUser = { name: string; email: string; avatarUrl: string | null; isAdmin: boolean; planName: string };

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

// Số dư chạy nhẹ tới giá trị mới (~0.5 s) khi đổi; lần đầu hiện ngay.
function useTween(value: number | null, ms = 520): number | null {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current;
    from.current = value;
    if (value === null || a === null || a === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(k >= 1 ? value : a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

function CreditPill() {
  const { balance, label, held } = useCreditBalance();
  const shown = useTween(balance);
  return (
    <Link
      href="/credits"
      aria-label={`Số dư ${label} Credit`}
      className="press group flex h-10 items-center gap-2 rounded-full bg-white/[.05] pr-4 pl-1.5 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white/[.09]"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f5c84b]/[.12] shadow-[inset_0_0_0_1px_rgba(245,200,75,.28)]">
        <CoinMark size={18} />
      </span>
      <span className="text-[15.5px] leading-none font-semibold tabular-nums">{shown === null ? label : formatCredit(Math.round(shown * 100) / 100)}</span>
      {held > 0 && <span className="hidden text-xs font-medium text-muted lg:inline">· giữ {held.toLocaleString("vi-VN")}</span>}
    </Link>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  return (
    <Popover
      align="end"
      trigger={({ toggle, ref, ...aria }) => (
        <button ref={ref} type="button" onClick={toggle} aria-label="Tài khoản" className="press rounded-full ring-1 ring-white/10 hover:ring-white/25" {...aria}>
          <Avatar name={user.name} url={user.avatarUrl} size={34} />
        </button>
      )}
      className="w-64"
    >
      {(close) => (
        <div onClick={close}>
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-3">
            <Avatar name={user.name} url={user.avatarUrl} size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <p className="truncate text-xs text-muted">
                {user.planName} · {user.email}
              </p>
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <MenuItem href="/profile" icon={<Icon name="user" size={17} />}>
            Hồ sơ
          </MenuItem>
          <MenuItem href="/credits" icon={<Icon name="coin" size={17} />}>
            Credit
          </MenuItem>
          <MenuItem href="/pricing" icon={<Icon name="tag" size={17} />}>
            Bảng giá
          </MenuItem>
          {user.isAdmin && (
            <MenuItem href="/admin" icon={<Icon name="shield" size={17} />}>
              Quản trị
            </MenuItem>
          )}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Icon name="logout" size={17} />} onClick={() => signOut({ redirectTo: "/login" })}>
            Đăng xuất
          </MenuItem>
        </div>
      )}
    </Popover>
  );
}

function TopBar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header
      className={cx(
        "sticky top-0 z-50 pt-[var(--safe-t)] transition-[background-color,box-shadow] duration-[260ms]",
        scrolled ? "glass shadow-[0_1px_0_var(--color-line)]" : "bg-transparent",
      )}
    >
      {/* 3 cột: menu giữa luôn đứng yên khi pill Credit đổi độ rộng */}
      <div className="flex h-14 items-center gap-3 px-3 sm:px-5 md:grid md:grid-cols-[1fr_auto_1fr] lg:px-6">
        <div className="flex min-w-0 items-center">
          <Logo href="/explore" compact />
        </div>
        <nav aria-label="Chính" className="hidden items-center gap-0.5 md:flex">
          {NAV.map((n) => {
            const active = isActive(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "press relative flex h-9 items-center rounded-full px-3.5 text-[13.5px] font-medium lg:px-4",
                  active ? "bg-white/[.08] text-fg" : "text-muted hover:text-fg",
                )}
              >
                {n.label}
                {active && <span className="absolute -bottom-[7px] left-1/2 h-[3px] w-5 -translate-x-1/2 rounded-full" style={{ background: "var(--aura)" }} />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center justify-end gap-2 md:ml-0">
          <CreditPill />
          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}

function TabBar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Điều hướng"
      className="glass-strong fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-line pb-[var(--safe-b)] md:hidden"
    >
      {NAV.map((n) => {
        const active = isActive(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cx("press flex h-[58px] flex-col items-center justify-center gap-1 text-[10.5px] font-medium", active ? "text-fg" : "text-muted")}
          >
            <span className={cx("flex h-7 w-11 items-center justify-center rounded-full transition-colors duration-[260ms]", active && "bg-white/[.1]")}>
              <Icon name={n.icon} size={19} />
            </span>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

// Lúc trình duyệt rảnh: tải trước catalog các studio để bấm chuyển tab là có dữ liệu ngay (xem apiCached).
function usePrefetchCatalogs() {
  useEffect(() => {
    const run = () => {
      for (const kind of ["image", "video"]) apiCached(`/api/catalog?kind=${kind}`).catch(() => {});
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(run, 1500);
    return () => window.clearTimeout(t);
  }, []);
}

export function AppShell({ user, balance, held, children }: { user: ShellUser; balance: number; held: number; children: React.ReactNode }) {
  usePrefetchCatalogs();
  return (
    <ToastProvider>
      <EventsProvider initialBalance={balance} initialHeld={held}>
        <div className="am app-shell">
          <TopBar user={user} />
          <div className="pb-[var(--tabbar-h)]">{children}</div>
          <TabBar />
        </div>
      </EventsProvider>
    </ToastProvider>
  );
}
