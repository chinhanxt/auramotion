import Link from "next/link";
import { CreditPacks } from "@/components/billing/CreditPacks";
import type { CreditPack, PlanCode } from "@/components/billing/labels";
import { PricingPlans, type PricingPlan } from "@/components/billing/PricingPlans";
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
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
        <Link href="/" className="font-semibold">
          AuraMotion
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          {userId ? (
            <Link href="/studio/image" className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-800">
              Vào Studio
            </Link>
          ) : (
            <>
              <Link href="/login?callbackUrl=/pricing" className="rounded-md px-3 py-1.5 text-neutral-700 hover:bg-neutral-100">
                Đăng nhập
              </Link>
              <Link href="/register" className="rounded-md bg-neutral-900 px-3 py-1.5 font-medium text-white hover:bg-neutral-800">
                Đăng ký
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-8 md:py-12">
        <section className="space-y-6">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold md:text-3xl">Bảng giá</h1>
            <p className="text-sm text-neutral-600">Chọn gói phù hợp. Thanh toán bằng QR chuyển khoản, kích hoạt tự động.</p>
          </div>
          <PricingPlans plans={items} currentCode={currentCode} />
          <p className="text-center text-xs text-neutral-500">
            Credit gói cấp lại mỗi tháng và không cộng dồn sang tháng sau. Hết hạn gói, tài khoản tự về gói Free.
          </p>
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Mua thêm Credit</h2>
            <p className="text-sm text-neutral-600">Credit mua lẻ không hết hạn, dùng sau khi hết Credit gói.</p>
          </div>
          <CreditPacks packs={packs} returnTo="/pricing" />
        </section>
      </main>
    </div>
  );
}
