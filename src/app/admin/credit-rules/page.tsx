import { CreditRulesView } from "@/components/admin/biz/CreditRulesView";
import { getCreditRules } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminCreditRulesPage() {
  await adminPage();
  return <CreditRulesView data={await getCreditRules()} />;
}
