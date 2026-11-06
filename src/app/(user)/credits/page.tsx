import { CreditsView } from "@/components/billing/CreditsView";
import type { CreditPack } from "@/components/billing/labels";
import { getSetting } from "@/server/services/settings";

export const metadata = { title: "Credit · AuraMotion" };

export default async function CreditsPage() {
  const packs = await getSetting<CreditPack[]>("credit_packs").catch(() => []);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Credit</h1>
      <CreditsView packs={packs} />
    </div>
  );
}
