import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { getCatalog } from "@/server/services/catalog";

const kindSchema = z.enum(["image", "video", "assemble", "story"], { message: "Loại tác vụ không hợp lệ" });

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const kind = kindSchema.parse(new URL(req.url).searchParams.get("kind"));
    return getCatalog(user.id, kind);
  });
}
