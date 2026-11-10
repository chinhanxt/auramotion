import { CreditsView } from "@/components/billing/CreditsView";
import type { CreditPack } from "@/components/billing/labels";
import { getSetting } from "@/server/services/settings";

export const metadata = { title: "Credit · AuraMotion" };

export default async function CreditsPage() {
  const packs = await getSetting<CreditPack[]>("credit_packs").catch(() => []);
  return (
    <div className="mx-auto max-w-[1600px] px-3 pt-3 pb-16 sm:px-5 lg:px-6">
      <h1 className="t-h2 mb-5">Credit</h1>
      <CreditsView packs={packs} />
    </div>
  );
}
