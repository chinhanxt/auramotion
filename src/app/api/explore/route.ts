import { z } from "zod";
import { handle } from "@/lib/http";
import { getExplore } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

const querySchema = z.object({ cursor: z.string().min(1).max(100).optional() });

// Công khai: kết quả nổi bật do Admin chọn.
export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const { cursor } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return getExplore(cursor);
  });
}
