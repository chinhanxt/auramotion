import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";
import { handleWebhook } from "@/server/services/payment";

const MAX_BODY_BYTES = 64 * 1024;

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) {
      throw new AppError("VALIDATION", "Dữ liệu webhook quá lớn", 413);
    }
    return handleWebhook(await req.text(), req.headers.get("x-signature"));
  });
}
