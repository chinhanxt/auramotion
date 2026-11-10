import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { requireUser } from "@/lib/auth";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";

export const dynamic = "force-dynamic";

export default async function UserLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  const [balance, { plan }] = await Promise.all([getBalance(user.id), getActivePlan(user.id)]);

  return (
    <AppShell
      user={{ name: user.name, email: user.email, avatarUrl: user.avatarUrl, isAdmin: user.role === "ADMIN", planName: plan.name }}
      balance={balance.available.toNumber()}
      held={balance.held.toNumber()}
    >
      {children}
    </AppShell>
  );
}
