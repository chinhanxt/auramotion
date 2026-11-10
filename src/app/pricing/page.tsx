import { CreditPacks } from "@/components/billing/CreditPacks";
import type { CreditPack, PlanCode } from "@/components/billing/labels";
import { PricingPlans, type PricingPlan } from "@/components/billing/PricingPlans";
import { AuraField } from "@/components/landing/AuraField";
import { Footer } from "@/components/layout/Footer";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicShell } from "@/components/layout/PublicShell";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActivePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bảng giá · AuraMotion" };

export default async function PricingPage() {
  const session = await auth();
  const userId = session?.user?.id;
  const [plans, lockedModels, packs, active] = await Promise.all([
    db.plan.findMany({ orderBy: { rank: "asc" } }),
    db.aiModel.findMany({
      where: { enabled: true, minPlanRank: { gt: 0 } },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { name: true, minPlanRank: true },
    }),
    getSetting<CreditPack[]>("credit_packs").catch(() => []),
    userId ? getActivePlan(userId).catch(() => null) : null,
  ]);

  const items: PricingPlan[] = plans.map((p) => ({
    code: p.code,
    name: p.name,
    priceMonth: p.priceMonth,
    priceYear: p.priceYear,
    monthlyCredits: p.monthlyCredits.toNumber(),
    maxConcurrent: p.maxConcurrent,
    maxDurationSec: p.maxDurationSec,
    unlocks: lockedModels.filter((m) => m.minPlanRank <= p.rank).map((m) => m.name),
  }));
  const currentCode: PlanCode | null = active?.plan.code ?? null;

  return (
    <PublicShell>
      <PublicHeader loggedIn={Boolean(userId)} />
      <main className="relative overflow-hidden px-3 pb-20 sm:px-6 lg:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px]" aria-hidden="true">
          <AuraField intensity={0.55} />
        </div>
        <section className="relative mx-auto max-w-[1280px] space-y-10 pt-14 sm:pt-20">
          <div className="space-y-3 text-center">
            <h1 className="t-display text-[clamp(2.4rem,1.2rem+4vw,4.6rem)]">Bảng giá</h1>
            <p className="text-sm text-muted">QR chuyển khoản · kích hoạt tự động</p>
          </div>
          <PricingPlans plans={items} currentCode={currentCode} />
          <p className="text-center text-xs text-dim">Credit gói cấp lại mỗi tháng, không cộng dồn. Hết hạn gói, tài khoản về Free.</p>
        </section>

        <section className="relative mx-auto mt-20 max-w-[1280px] space-y-5">
          <div className="space-y-1">
            <h2 className="t-h2">Credit lẻ</h2>
            <p className="text-sm text-muted">Không hết hạn, dùng sau khi hết Credit gói.</p>
          </div>
          <CreditPacks packs={packs} returnTo="/pricing" />
        </section>
      </main>
      <Footer />
    </PublicShell>
  );
}
