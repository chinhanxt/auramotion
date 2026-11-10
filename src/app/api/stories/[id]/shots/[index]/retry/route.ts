import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { retryShot } from "@/server/services/story";

const indexSchema = z.coerce.number({ message: "Cảnh không hợp lệ" }).int().min(0).max(20);

export function POST(_req: Request, { params }: { params: Promise<{ id: string; index: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id, index } = await params;
    return retryShot(user.id, id, indexSchema.parse(index));
  });
}
