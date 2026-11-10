import Link from "next/link";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-6 lg:px-10">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
          <Link href="/studio/image" className="hover:text-fg">
            Ảnh
          </Link>
          <Link href="/studio/video" className="hover:text-fg">
            Video
          </Link>
          <Link href="/studio/story" className="hover:text-fg">
            Story
          </Link>
          <Link href="/studio/edit" className="hover:text-fg">
            Ghép
          </Link>
          <Link href="/pricing" className="hover:text-fg">
            Bảng giá
          </Link>
        </nav>
        <p className="text-xs text-dim">© {new Date().getFullYear()} AuraMotion</p>
      </div>
    </footer>
  );
}
