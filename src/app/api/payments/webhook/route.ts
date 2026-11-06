import { handle } from "@/lib/http";
import { handleWebhook } from "@/server/services/payment";

export function POST(req: Request): Promise<Response> {
  return handle(async () => handleWebhook(await req.text(), req.headers.get("x-signature")));
}
