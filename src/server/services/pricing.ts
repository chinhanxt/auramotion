import { Prisma, type AiModel, type Plan } from "@prisma/client";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { getSetting } from "@/server/services/settings";

const Decimal = Prisma.Decimal;

const prompt = z.string().trim().min(1).max(2000);

const imageParams = z.object({
  kind: z.literal("image"),
  modelId: z.string().min(1),
  prompt,
  aspectRatio: z.string().min(1),
  imageCount: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
  presetId: z.string().min(1).optional(),
  inputUrl: z.string().min(1).optional(),
});

const videoParams = z.object({
  kind: z.literal("video"),
  modelId: z.string().min(1),
  prompt,
  aspectRatio: z.string().min(1),
  durationSec: z.union([z.literal(5), z.literal(10)]).optional(),
  presetId: z.string().min(1).optional(),
  inputUrl: z.string().min(1).optional(),
});

const assembleParams = z.object({
  kind: z.literal("assemble"),
  modelId: z.string().min(1),
  aspect: z.enum(["9:16", "16:9", "1:1"]),
  clips: z
    .array(
      z.object({
        jobId: z.string().min(1),
        index: z.number().int().min(0).optional(),
        in: z.number().min(0).optional(),
        out: z.number().positive().optional(),
        duration: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(12),
  lines: z.array(z.string().trim().min(1).max(200)).max(20),
  voice: z.object({ preset: z.string().min(1).optional(), refUrl: z.string().min(1).optional() }).optional(),
  musicId: z.string().min(1).optional(),
  subtitles: z.boolean(),
  keepClipAudio: z.boolean(),
});

export const generationParamsSchema = z.discriminatedUnion("kind", [imageParams, videoParams, assembleParams]);

export type GenerationParams = z.infer<typeof generationParamsSchema>;
export type AssembleParams = Extract<GenerationParams, { kind: "assemble" }>;

type ModelOptions = { aspectRatios?: string[]; counts?: number[]; durations?: number[] };

const KIND = { image: "IMAGE", video: "VIDEO", assemble: "ASSEMBLE" } as const;

function invalid(message: string): never {
  throw new AppError("VALIDATION", message);
}

function allowed(list: number[] | string[] | undefined, value: number | string): boolean {
  return (list as (number | string)[] | undefined)?.includes(value) ?? false;
}

export function validateParams(
  p: GenerationParams,
  model: Pick<AiModel, "kind" | "minPlanRank" | "options">,
  plan: Pick<Plan, "rank" | "maxDurationSec">,
): void {
  if (model.kind !== KIND[p.kind]) invalid("Engine không hỗ trợ loại tác vụ này");
  if (model.minPlanRank > plan.rank) throw new AppError("PLAN_MODEL", "Gói hiện tại không dùng được engine này");

  const options = (model.options ?? {}) as ModelOptions;
  const ratio = p.kind === "assemble" ? p.aspect : p.aspectRatio;
  if (!allowed(options.aspectRatios, ratio)) invalid("Tỷ lệ khung hình không hợp lệ");

  if (p.kind === "image" && !allowed(options.counts, p.imageCount ?? 1)) invalid("Số ảnh không hợp lệ");

  if (p.kind === "video") {
    const duration = p.durationSec ?? 5;
    if (!allowed(options.durations, duration)) invalid("Thời lượng video không hợp lệ");
    if (duration > plan.maxDurationSec) {
      throw new AppError("PLAN_DURATION", `Gói hiện tại chỉ tạo video tối đa ${plan.maxDurationSec} giây`);
    }
  }

  if (p.kind === "assemble" && p.voice?.refUrl && plan.rank < 1) {
    throw new AppError("PLAN_MODEL", "Giọng của tôi chỉ dành cho gói Pro trở lên");
  }
}

export async function quote(p: GenerationParams, model: Pick<AiModel, "baseCost">): Promise<Prisma.Decimal> {
  const base = new Decimal(model.baseCost);
  let cost: Prisma.Decimal;
  if (p.kind === "image") cost = base.mul(p.imageCount ?? 1);
  else if (p.kind === "video") cost = base.mul(p.durationSec ?? 5).div(5);
  else {
    const lineCost = new Decimal(await getSetting<number>("voice_line_cost"));
    cost = base.add(lineCost.mul(p.lines.length));
  }
  return cost.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
