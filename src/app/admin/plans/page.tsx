import { EntityForm } from "@/components/admin/EntityForm";
import { cardClass } from "@/components/admin/format";
import { listPlans } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminPlansPage() {
  await adminPage();
  const plans = await listPlans();

  return (
    <>
      <h1 className="text-xl font-semibold">Gói dịch vụ</h1>
      <div className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => (
          <section key={p.id} className={`${cardClass} space-y-3`}>
            <h2 className="font-medium">
              {p.name} <span className="text-sm font-normal text-neutral-500">({p.code})</span>
            </h2>
            <EntityForm
              url="/api/admin/plans"
              method="PATCH"
              extra={{ id: p.id }}
              initial={{
                name: p.name,
                priceMonth: p.priceMonth,
                priceYear: p.priceYear,
                monthlyCredits: p.monthlyCredits.toNumber(),
                maxConcurrent: p.maxConcurrent,
                maxDurationSec: p.maxDurationSec,
              }}
              fields={[
                { name: "name", label: "Tên", type: "text", wide: true },
                { name: "priceMonth", label: "Giá tháng (₫)", type: "number", step: "1000" },
                { name: "priceYear", label: "Giá năm (₫)", type: "number", step: "1000" },
                { name: "monthlyCredits", label: "Credit / tháng", type: "number" },
                { name: "maxConcurrent", label: "Tác vụ cùng lúc", type: "number", step: "1" },
                { name: "maxDurationSec", label: "Video tối đa (giây)", type: "number", step: "1" },
              ]}
            />
          </section>
        ))}
      </div>
    </>
  );
}
