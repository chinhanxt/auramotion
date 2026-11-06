import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { handle } from "@/lib/http";

describe("handle", () => {
  it("maps AppError to its status and error body", async () => {
    const res = await handle(async () => {
      throw new AppError("NOT_FOUND", "x", 404);
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: "NOT_FOUND", message: "x" } });
  });

  it("returns 200 JSON on success", async () => {
    const res = await handle(async () => ({ ok: true }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("maps ZodError to 400 VALIDATION", async () => {
    const res = await handle(async () => z.object({ n: z.number() }).parse({ n: "a" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION");
  });
});
