import Link from "next/link";
import { cx } from "@/components/ui/cx";

export function AuraDot({ className }: { className?: string }) {
  return (
    <span className={cx("relative inline-flex h-2.5 w-2.5 shrink-0", className)} aria-hidden="true">
      <span className="absolute -inset-1 rounded-full opacity-70 blur-[5px]" style={{ background: "var(--aura)" }} />
      <span className="relative h-2.5 w-2.5 rounded-full" style={{ background: "var(--aura)" }} />
    </span>
  );
}

export function Logo({ href = "/", className, compact }: { href?: string; className?: string; compact?: boolean }) {
  return (
    <Link href={href} className={cx("press inline-flex items-center gap-2 text-[17px] font-bold tracking-[-0.04em]", className)} aria-label="AuraMotion">
      <AuraDot />
      <span className={cx(compact && "max-[380px]:hidden")}>AuraMotion</span>
    </Link>
  );
}
