import { Prisma, type AiModel, type Plan } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import {
  generationParamsSchema,
  quote,
  validateParams,
  type GenerationParams,
} from "@/server/services/pricing";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

let models: Record<string, AiModel>;
let plans: Record<string, Plan>;

function image(modelId: string, extra: Partial<Extract<GenerationParams, { kind: "image" }>> = {}): GenerationParams {
  return { kind: "image", modelId, prompt: "a bottle", aspectRatio: "1:1", ...extra };
}

function video(modelId: string, durationSec?: 5 | 10): GenerationParams {
  return { kind: "video", modelId, prompt: "a bottle", aspectRatio: "9:16", durationSec };
}

function assemble(lines: string[], voice?: { preset?: string; refUrl?: string }): GenerationParams {
  return {
    kind: "assemble",
    modelId: models.assemble.id,
    aspect: "9:16",
    clips: [{ jobId: "job-1" }],
    lines,
    voice,
    subtitles: true,
    keepClipAudio: false,
  };
}

function errorCode(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
  return undefined;
}

describe("pricing", () => {
  beforeAll(async () => {
    await resetDb();
    await seed();
    const byName = async (name: string) => db.aiModel.findUniqueOrThrow({ where: { name } });
    models = {
      muse: await byName("MUSE Ảnh"),
      agy: await byName("Gemini Ảnh"),
      codex: await byName("Codex Ảnh"),
      museVideo: await byName("MUSE Video"),
      assemble: await byName("Ghép video"),
    };
    const byCode = async (code: "free" | "pro" | "ultra") => db.plan.findUniqueOrThrow({ where: { code } });
    plans = { free: await byCode("free"), pro: await byCode("pro"), ultra: await byCode("ultra") };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  describe("quote", () => {
    it("MUSE image × 1 = 1.00, × 4 = 4.00", async () => {
      expect((await quote(image(models.muse.id), models.muse)).toFixed(2)).toBe("1.00");
      expect((await quote(image(models.muse.id, { imageCount: 4 }), models.muse)).toFixed(2)).toBe("4.00");
    });

    it("Codex image × 1 = 2.00", async () => {
      expect((await quote(image(models.codex.id), models.codex)).toFixed(2)).toBe("2.00");
    });

    it("video 5s = 3.00, 10s = 6.00", async () => {
      expect((await quote(video(models.museVideo.id, 5), models.museVideo)).toFixed(2)).toBe("3.00");
      expect((await quote(video(models.museVideo.id, 10), models.museVideo)).toFixed(2)).toBe("6.00");
      expect((await quote(video(models.museVideo.id), models.museVideo)).toFixed(2)).toBe("3.00");
    });

    it("assemble 3 lines = 5.00, 0 lines = 2.00", async () => {
      expect((await quote(assemble(["a", "b", "c"]), models.assemble)).toFixed(2)).toBe("5.00");
      expect((await quote(assemble([]), models.assemble)).toFixed(2)).toBe("2.00");
    });

    it("rounds HALF_UP to 2 decimals", async () => {
      const tiny = { ...models.muse, baseCost: new Prisma.Decimal("0.005") };
      expect((await quote(image(tiny.id), tiny)).toFixed(2)).toBe("0.01");
      const odd = { ...models.museVideo, baseCost: new Prisma.Decimal("0.33") };
      expect((await quote(video(odd.id, 10), odd)).toFixed(2)).toBe("0.66");
      expect((await quote(video(odd.id, 5), { ...odd, baseCost: new Prisma.Decimal("1.115") })).toFixed(2)).toBe("1.12");
    });
  });

  describe("validateParams", () => {
    it("accepts valid params", () => {
      expect(errorCode(() => validateParams(image(models.muse.id, { imageCount: 4 }), models.muse, plans.free))).toBeUndefined();
      expect(errorCode(() => validateParams(video(models.museVideo.id, 10), models.museVideo, plans.pro))).toBeUndefined();
      expect(errorCode(() => validateParams(assemble(["a"], { refUrl: "/media/uploads/u/x.wav" }), models.assemble, plans.pro))).toBeUndefined();
    });

    it("rejects duration above plan", () => {
      expect(errorCode(() => validateParams(video(models.museVideo.id, 10), models.museVideo, plans.free))).toBe("PLAN_DURATION");
    });

    it("rejects model above plan", () => {
      expect(errorCode(() => validateParams(image(models.codex.id), models.codex, plans.free))).toBe("PLAN_MODEL");
      expect(errorCode(() => validateParams(image(models.codex.id), models.codex, plans.pro))).toBeUndefined();
    });

    it("rejects imageCount not offered by model", () => {
      expect(errorCode(() => validateParams(image(models.agy.id, { imageCount: 2 }), models.agy, plans.free))).toBe("VALIDATION");
    });

    it("rejects unsupported aspect ratio", () => {
      expect(errorCode(() => validateParams(image(models.muse.id, { aspectRatio: "21:9" }), models.muse, plans.free))).toBe("VALIDATION");
    });

    it("rejects kind mismatch", () => {
      expect(errorCode(() => validateParams(image(models.museVideo.id), models.museVideo, plans.free))).toBe("VALIDATION");
    });

    it("rejects voice clone on Free", () => {
      expect(errorCode(() => validateParams(assemble(["a"], { refUrl: "/media/uploads/u/x.wav" }), models.assemble, plans.free))).toBe("PLAN_MODEL");
      expect(errorCode(() => validateParams(assemble(["a"], { preset: "Trúc Ly" }), models.assemble, plans.free))).toBeUndefined();
    });
  });

  describe("generationParamsSchema", () => {
    it("parses each kind", () => {
      expect(generationParamsSchema.safeParse(image("m", { imageCount: 2 })).success).toBe(true);
      expect(generationParamsSchema.safeParse(video("m", 10)).success).toBe(true);
      expect(generationParamsSchema.safeParse({ ...assemble(["a"]), modelId: "m" }).success).toBe(true);
    });

    it("rejects out-of-range fields", () => {
      expect(generationParamsSchema.safeParse(image("m", { prompt: "" })).success).toBe(false);
      expect(generationParamsSchema.safeParse(image("m", { prompt: "x".repeat(2001) })).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...image("m"), imageCount: 3 }).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...video("m"), durationSec: 7 }).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...assemble([]), modelId: "m", clips: [] }).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...assemble(Array(21).fill("a")), modelId: "m" }).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...assemble(["x".repeat(201)]), modelId: "m" }).success).toBe(false);
      expect(generationParamsSchema.safeParse({ ...assemble([""]), modelId: "m" }).success).toBe(false);
    });
  });
});
