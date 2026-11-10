import { PaymentsView } from "@/components/admin/biz/PaymentsView";
import { plain } from "@/components/admin/plain";
import { listPayments } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const STATUSES = ["PENDING", "SUCCEEDED", "CANCELED"] as const;

export default async function AdminPaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === one(sp.status));
  const search = one(sp.search);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  return <PaymentsView data={plain(await listPayments({ status, search, page }))} />;
}
