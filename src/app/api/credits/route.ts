import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";

const PAGE_SIZE = 30;
const PAYMENT_LIMIT = 20;

const querySchema = z.object({ cursor: z.string().min(1).max(100).optional() });

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { cursor } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    const [balance, { plan, subscription }, rows, payments] = await Promise.all([
      getBalance(user.id),
      getActivePlan(user.id),
      db.creditTransaction.findMany({
        where: { userId: user.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: PAGE_SIZE + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          type: true,
          bucket: true,
          amount: true,
          note: true,
          jobId: true,
          paymentId: true,
          createdAt: true,
          job: { select: { kind: true } },
        },
      }),
      db.payment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: PAYMENT_LIMIT,
        select: {
          id: true,
          type: true,
          planCode: true,
          period: true,
          creditAmount: true,
          amount: true,
          refCode: true,
          status: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ]);
    const page = rows.slice(0, PAGE_SIZE);
    return {
      balance,
      plan,
      subscription,
      transactions: page.map(({ job, ...t }) => ({ ...t, jobKind: job?.kind ?? null })),
      nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
      payments,
    };
  });
}
