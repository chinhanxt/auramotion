import { CreditsSkeleton } from "@/components/billing/CreditsView";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1600px] px-3 pt-3 sm:px-5 lg:px-6">
      <div className="skel mb-5 h-9 w-28 rounded-m1" />
      <CreditsSkeleton />
    </div>
  );
}
