import Link from "next/link";
import { formatVnd } from "@/components/billing/labels";
import { LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatCredit } from "@/lib/api-client";

const FEATURES: { href: string; title: string; line: string; icon: IconName; art: string }[] = [
  { href: "/studio/image", title: "Ảnh", line: "Phong cách dựng sẵn, nhiều engine.", icon: "image", art: "radial-gradient(70% 70% at 30% 30%, rgba(124,92,255,.7), transparent 60%), radial-gradient(60% 60% at 80% 80%, rgba(45,212,191,.45), transparent 60%)" },
  { href: "/studio/video", title: "Video", line: "Khung đầu + camera, chạy mượt.", icon: "video", art: "radial-gradient(70% 70% at 70% 25%, rgba(255,79,216,.65), transparent 60%), radial-gradient(60% 60% at 20% 85%, rgba(255,179,107,.45), transparent 60%)" },
  { href: "/studio/story", title: "Story", line: "Một ý tưởng, nhiều cảnh song song.", icon: "story", art: "radial-gradient(70% 70% at 25% 70%, rgba(255,179,107,.6), transparent 60%), radial-gradient(60% 60% at 80% 20%, rgba(124,92,255,.55), transparent 60%)" },
  { href: "/studio/edit", title: "Ghép", line: "Giọng Việt, nhạc, phụ đề.", icon: "cut", art: "radial-gradient(70% 70% at 70% 70%, rgba(212,255,58,.4), transparent 60%), radial-gradient(60% 60% at 20% 20%, rgba(96,165,250,.5), transparent 60%)" },
];

export function FeatureTiles() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {FEATURES.map((f, i) => (
        <Link key={f.href} href={f.href} className="feature-tile reveal lift group relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-m4 bg-s1 p-6 hairline sm:aspect-[5/6]" style={{ "--i": i } as React.CSSProperties}>
          <div className="feature-art absolute -inset-[15%]" style={{ background: f.art }} aria-hidden="true" />
          <div className="grain absolute inset-0" aria-hidden="true" />
          <div className="feature-frames absolute inset-x-0 top-[16%] flex justify-center" aria-hidden="true">
            {[0, 1, 2].map((k) => (
              <span
                key={k}
                className={cx("glass mx-[-14px] block rounded-m2 shadow-[0_20px_40px_-10px_rgba(0,0,0,.6)] hairline", k === 1 ? "z-10 h-36 w-24" : "mt-5 h-28 w-20 opacity-70")}
              />
            ))}
          </div>
          <div className="relative">
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-m1 bg-black/30 backdrop-blur-md hairline">
              <Icon name={f.icon} size={20} />
            </span>
            <p className="text-2xl font-bold tracking-tight">{f.title}</p>
            <p className="mt-1 text-sm text-fg/70">{f.line}</p>
          </div>
          <span className="absolute top-5 right-5 flex h-9 w-9 items-center justify-center rounded-full bg-black/30 opacity-0 backdrop-blur-md transition-opacity duration-[260ms] group-hover:opacity-100">
            <Icon name="arrowRight" size={16} />
          </span>
        </Link>
      ))}
    </div>
  );
}

export type TeaserPlan = { code: string; name: string; priceMonth: number; monthlyCredits: number };

export function PricingTeaser({ plans }: { plans: TeaserPlan[] }) {
  if (plans.length === 0) return null;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {plans.map((p, i) => {
        const pro = p.code === "pro";
        return (
          <div key={p.code} className={cx("reveal relative overflow-hidden rounded-m4 p-6", pro ? "aura-ring bg-[linear-gradient(180deg,rgba(124,92,255,.16),#0d0d10_70%)]" : "bg-s1 hairline")} style={{ "--i": i } as React.CSSProperties}>
            <div className="flex items-center justify-between">
              <p className="font-semibold">{p.name}</p>
              {pro && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-ink">Phổ biến</span>}
            </div>
            <p className="mt-4 text-3xl font-extrabold tracking-[-0.04em] tabular-nums">
              {p.priceMonth === 0 ? "0đ" : formatVnd(p.priceMonth)}
              {p.priceMonth > 0 && <span className="ml-1 text-sm font-normal text-muted">/tháng</span>}
            </p>
            <p className="mt-1 text-sm text-muted">{formatCredit(p.monthlyCredits)} Credit mỗi tháng</p>
          </div>
        );
      })}
      <div className="md:col-span-3 flex justify-center pt-2">
        <LinkButton href="/pricing" variant="outline" iconRight="arrowRight">
          Xem chi tiết bảng giá
        </LinkButton>
      </div>
    </div>
  );
}

export function SectionHead({ kicker, title, action }: { kicker?: string; title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && <p className="t-label mb-2">{kicker}</p>}
        <h2 className="t-h1">{title}</h2>
      </div>
      {action}
    </div>
  );
}
