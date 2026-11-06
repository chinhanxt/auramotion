import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getStats } from "@/server/services/admin";

const rangeSchema = z.enum(["1d", "7d", "30d"], { message: "Khoảng thời gian không hợp lệ" }).default("7d");

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const range = rangeSchema.parse(new URL(req.url).searchParams.get("range") ?? undefined);
    return getStats(range);
  });
}
