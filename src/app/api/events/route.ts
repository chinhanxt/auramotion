import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { createEventStream } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE: sự kiện job / story / credit của user đang đăng nhập; ping mỗi 20 s.
export async function GET(req: Request): Promise<Response> {
  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch (err) {
    return handle(async () => {
      throw err;
    });
  }
  return new Response(createEventStream(userId, req.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
