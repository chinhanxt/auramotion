import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { createOrder } from "@/server/services/payment";

const orderSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PLAN"), planCode: z.enum(["pro", "ultra"]), period: z.enum(["MONTH", "YEAR"]) }),
  z.object({ type: z.literal("CREDIT"), credits: z.union([z.literal(100), z.literal(500), z.literal(1000)]) }),
]);

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return createOrder(user.id, orderSchema.parse(await readJson(req)));
  });
}
