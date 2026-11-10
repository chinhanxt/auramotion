import Link from "next/link";
import { LinkButton } from "@/components/ui/Button";
import { Logo } from "./Logo";

export function PublicHeader({ loggedIn, transparent }: { loggedIn: boolean; transparent?: boolean }) {
  return (
    <header className={`${transparent ? "absolute" : "sticky glass shadow-[0_1px_0_var(--color-line)]"} inset-x-0 top-0 z-50 pt-[var(--safe-t)]`}>
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6 lg:px-10">
        <Logo />
        <nav className="ml-auto flex items-center gap-1 sm:gap-2">
          <Link href="/pricing" className="press hidden h-9 items-center rounded-full px-3.5 text-sm font-medium text-fg/75 hover:text-fg sm:inline-flex">
            Bảng giá
          </Link>
          {loggedIn ? (
            <LinkButton href="/studio/image" variant="primary" size="sm" iconRight="arrowRight">
              Vào Studio
            </LinkButton>
          ) : (
            <>
              <Link href="/login" className="press inline-flex h-9 items-center rounded-full px-3.5 text-sm font-medium text-fg/75 hover:text-fg">
                Đăng nhập
              </Link>
              <LinkButton href="/register" variant="primary" size="sm">
                Bắt đầu
              </LinkButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
