import { ZodError } from "zod";
import { AppError } from "./errors";

export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    const result = await fn();
    return Response.json(result ?? null, { status: 200 });
  } catch (err) {
    if (err instanceof AppError) {
      return Response.json({ error: { code: err.code, message: err.message } }, { status: err.status });
    }
    if (err instanceof ZodError) {
      const message = err.issues[0]?.message ?? "Dữ liệu không hợp lệ";
      return Response.json({ error: { code: "VALIDATION", message } }, { status: 400 });
    }
    console.error(err);
    return Response.json({ error: { code: "INTERNAL", message: "Lỗi hệ thống, vui lòng thử lại" } }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => {
    throw new AppError("VALIDATION", "Dữ liệu gửi lên không hợp lệ");
  });
}
