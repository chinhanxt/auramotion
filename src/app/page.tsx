import { AuraField } from "@/components/landing/AuraField";
import { HeroComposer } from "@/components/landing/HeroComposer";
import { FeatureTiles, PricingTeaser, SectionHead, type TeaserPlan } from "@/components/landing/Sections";
import { ExploreGrid, ThemeStrip } from "@/components/landing/Showcase";
import { Footer } from "@/components/layout/Footer";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { PublicShell } from "@/components/layout/PublicShell";
import { LinkButton } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [session, plans] = await Promise.all([
    auth().catch(() => null),
    db.plan
      .findMany({ orderBy: { rank: "asc" }, select: { code: true, name: true, priceMonth: true, monthlyCredits: true } })
      .then((ps): TeaserPlan[] => ps.map((p) => ({ ...p, monthlyCredits: p.monthlyCredits.toNumber() })))
      .catch(() => [] as TeaserPlan[]),
  ]);
  const loggedIn = Boolean(session?.user?.id);

  return (
    <PublicShell>
      <PublicHeader loggedIn={loggedIn} transparent />
      <main>
        <section className="relative flex min-h-[100svh] items-center overflow-hidden px-4 pt-24 pb-16 sm:px-6">
          <AuraField />
          <div className="hero-in relative mx-auto flex w-full max-w-6xl flex-col items-center text-center">
            <p className="glass mb-7 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-fg/80 hairline">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Ảnh · Video · Story · Ghép
            </p>
            <h1 className="t-display max-w-[16ch] text-balance">
              Ý tưởng thành <span className="aura-text">chuyển động.</span>
            </h1>
            <div className="mt-10 w-full">
              <HeroComposer loggedIn={loggedIn} />
            </div>
            {loggedIn && (
              <div className="mt-6">
                <LinkButton href="/studio/image" variant="glass" iconRight="arrowRight">
                  Mở Studio
                </LinkButton>
              </div>
            )}
          </div>
          <a href="#explore" aria-label="Xem thêm" className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-muted hover:text-fg sm:block">
            <Icon name="chevronDown" size={22} />
          </a>
        </section>

        <section id="explore" className="scroll-mt-16 px-3 py-16 sm:px-6 lg:px-10 lg:py-24">
          <SectionHead kicker="Khám phá" title="Được tạo trên AuraMotion" />
          <ExploreGrid />
        </section>

        <section className="py-10 lg:py-16">
          <div className="px-3 sm:px-6 lg:px-10">
            <SectionHead kicker="Chủ đề" title="Một chạm, đổi chất ảnh." />
          </div>
          <ThemeStrip />
        </section>

        <section className="px-3 py-16 sm:px-6 lg:px-10 lg:py-24">
          <SectionHead kicker="Studio" title="Bốn công cụ. Một luồng." />
          <FeatureTiles />
        </section>

        <section className="px-3 py-16 sm:px-6 lg:px-10 lg:py-24">
          <SectionHead kicker="Bảng giá" title="Bắt đầu miễn phí." />
          <PricingTeaser plans={plans} />
        </section>

        <section className="relative overflow-hidden px-4 py-24 text-center sm:px-6 lg:py-32">
          <AuraField intensity={0.7} />
          <div className="relative mx-auto max-w-3xl space-y-8">
            <h2 className="t-display text-[clamp(2.2rem,1rem+4vw,5rem)]">Thử ngay.</h2>
            <LinkButton href={loggedIn ? "/studio/video" : "/register"} variant="primary" size="lg" iconRight="arrowRight">
              {loggedIn ? "Vào Studio" : "Tạo tài khoản miễn phí"}
            </LinkButton>
          </div>
        </section>
      </main>
      <Footer />
    </PublicShell>
  );
}
