import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { prewrite } from "@/server/ai/prewrite";
import { getActivePlan } from "@/server/services/plan";

const bodySchema = z.object({
  idea: z.string().trim().min(1, "Hãy nhập ý tưởng").max(2000, "Ý tưởng tối đa 2000 ký tự"),
  kind: z.enum(["image", "video"], { message: "Loại không hợp lệ" }),
  aspect: z.enum(["1:1", "9:16", "16:9", "4:5"], { message: "Tỷ lệ khung không hợp lệ" }),
  durationSec: z.number().int().min(1).max(120).optional(),
  skillId: z.string().min(1).max(100).optional(),
  styleId: z.string().min(1).max(100).optional(),
  cameraId: z.string().min(1).max(100).optional(),
  hasRef: z.boolean().optional(),
});

// Mỗi người tối đa vài lần viết trước cùng lúc (app 1 tiến trình).
const MAX_PER_USER = 2;
const globalForPrewrite = globalThis as unknown as { prewriteBusy?: Map<string, number> };
const busy = (globalForPrewrite.prewriteBusy ??= new Map<string, number>());

// Viết trước prompt khi người dùng còn gõ → { key, status: "ready" | "pending" | "error" | "disabled", prompt?, skill?, provider? }.
// Gọi lại cùng tham số để lấy kết quả; job autoWrite cùng khóa dùng luôn bản này.
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const body = bodySchema.parse(await readJson(req));
    const { plan } = await getActivePlan(user.id);
    // Job chỉ mang 1 preset: style cho ảnh, camera cho video — khóa phải khớp với lúc job viết.
    const input = {
      ...body,
      styleId: body.kind === "image" ? body.styleId : undefined,
      cameraId: body.kind === "video" ? body.cameraId : undefined,
      planRank: plan.rank,
    };
    return prewrite(input, {
      canStart: () => (busy.get(user.id) ?? 0) < MAX_PER_USER,
      onStart: (p) => {
        busy.set(user.id, (busy.get(user.id) ?? 0) + 1);
        void p.finally(() => {
          const n = (busy.get(user.id) ?? 1) - 1;
          if (n <= 0) busy.delete(user.id);
          else busy.set(user.id, n);
        });
      },
    });
  });
}
