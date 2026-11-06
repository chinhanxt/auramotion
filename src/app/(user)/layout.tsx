import Link from "next/link";
import { redirect } from "next/navigation";
import { SignOutButton, UserNav } from "@/components/layout/UserNav";
import { requireUser } from "@/lib/auth";
import { formatCredit } from "@/lib/api-client";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";

export const dynamic = "force-dynamic";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const [balance, { plan }] = await Promise.all([getBalance(user.id), getActivePlan(user.id)]);
  const held = balance.held.toNumber();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 md:flex">
      <UserNav />
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
          <Link href="/studio/image" className="font-semibold md:hidden">
            AuraMotion
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{plan.name}</span>
            <Link href="/credits" className="font-medium hover:underline">
              {formatCredit(balance.available.toNumber())} Credit
              {held > 0 && <span className="ml-1 font-normal text-neutral-500">(đang giữ {formatCredit(held)})</span>}
            </Link>
            <span className="hidden max-w-40 truncate text-neutral-600 sm:inline">{user.name}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto max-w-6xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
