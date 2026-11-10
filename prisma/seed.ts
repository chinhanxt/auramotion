import bcrypt from "bcryptjs";
import type { JobKind, ModelProvider, PlanCode, Prisma } from "@prisma/client";
import { db } from "../src/lib/db";
import { startFree } from "../src/server/services/plan";
import { KNOWN_MODEL_IDS, effortBadge, legacyModelName, shortModelName } from "../src/server/services/model-naming";
import { CAMERAS, LEGACY_PRESET_META, SKILLS, THEMES } from "./seed-data";
import { SKILL_LIBRARY, SKILL_META } from "./skill-library";

const IMAGE_RATIOS = ["1:1", "9:16", "16:9", "4:5"];
const VIDEO_RATIOS = ["9:16", "16:9", "1:1"];

// Giá VND. Năm rẻ hơn tháng × 12 khoảng 20%.
const PLANS: {
  code: PlanCode;
  name: string;
  priceMonth: number;
  priceYear: number;
  monthlyCredits: number;
  maxConcurrent: number;
  maxDurationSec: number;
  rank: number;
}[] = [
  { code: "free", name: "Free", priceMonth: 0, priceYear: 0, monthlyCredits: 20, maxConcurrent: 1, maxDurationSec: 5, rank: 0 },
  { code: "pro", name: "Pro", priceMonth: 199000, priceYear: 1910000, monthlyCredits: 500, maxConcurrent: 3, maxDurationSec: 10, rank: 1 },
  { code: "ultra", name: "Ultra", priceMonth: 499000, priceYear: 4790000, monthlyCredits: 2000, maxConcurrent: 6, maxDurationSec: 10, rank: 2 },
];

type SeedModel = {
  name: string;
  provider: ModelProvider;
  engineModel: string;
  kind: JobKind;
  minPlanRank: number;
  baseCost: number;
  options: Prisma.InputJsonObject;
  sort: number;
  vendor: string;
  displayName: string;
  badge?: string;
  etaSec?: number;
  verified?: Prisma.InputJsonObject;
};

const IMAGE_OPTIONS = { aspectRatios: IMAGE_RATIOS, counts: [1], maxRefs: 1 };

const MODELS: SeedModel[] = [
  { name: "MUSE Ảnh", provider: "MUSE", engineModel: "muse-image", kind: "IMAGE", minPlanRank: 0, baseCost: 1, options: { aspectRatios: IMAGE_RATIOS, counts: [1, 2, 4], maxRefs: 1 }, sort: 1, vendor: "muse", displayName: "Muse Image" },
  // Ghim tài khoản Muse riêng cho ảnh (SEED_MUSE_IMAGE_ACCOUNT = id trong muse2api). Bỏ trống thì không tạo.
  ...(process.env.SEED_MUSE_IMAGE_ACCOUNT
    ? [{ name: "MUSE Ảnh 2", provider: "MUSE" as const, engineModel: "muse-image", kind: "IMAGE" as const, minPlanRank: 0, baseCost: 1, options: { aspectRatios: IMAGE_RATIOS, counts: [1, 2, 4], maxRefs: 1, museAccount: process.env.SEED_MUSE_IMAGE_ACCOUNT }, sort: 2, vendor: "muse", displayName: "Muse Image" }]
    : []),
  { name: "Gemini Ảnh", provider: "AGY", engineModel: "gemini-3.8-flash-medium", kind: "IMAGE", minPlanRank: 0, baseCost: 1, options: IMAGE_OPTIONS, sort: 2, vendor: "google", displayName: "Flash 3.8", badge: "Cân bằng" },
  { name: "Codex Ảnh", provider: "CODEX", engineModel: "gpt-6.1-sol", kind: "IMAGE", minPlanRank: 1, baseCost: 2, options: IMAGE_OPTIONS, sort: 3, vendor: "openai", displayName: "Sol 6.1" },
  { name: "MUSE Video", provider: "MUSE", engineModel: "muse-video", kind: "VIDEO", minPlanRank: 0, baseCost: 3, options: { aspectRatios: VIDEO_RATIOS, durations: [5, 10], maxRefs: 1 }, sort: 4, vendor: "muse", displayName: "Muse Video" },
  { name: "Ghép video", provider: "LOCAL", engineModel: "assemble", kind: "ASSEMBLE", minPlanRank: 0, baseCost: 2, options: { aspectRatios: VIDEO_RATIOS }, sort: 5, vendor: "local", displayName: "Ghép video" },
];

// Model ảnh đã test vẽ thật 10/11/2026 (ảnh 1:1, cùng prompt, codex: profile default). Cùng provider + engineModel + kind đã có dòng
// (vd "Codex Ảnh" = gpt-6.1-sol) thì dùng lại dòng đó, chỉ điền trường hiển thị còn trống.
const TESTED_AT = "2026-11-10T16:00:00+07:00";
const tested = (
  provider: ModelProvider,
  engineModel: string,
  vendor: string,
  displayName: string,
  badge: string,
  sec: number,
  sort: number,
): SeedModel => ({
  name: `${provider.toLowerCase()}:${engineModel}:IMAGE`,
  provider,
  engineModel,
  kind: "IMAGE",
  minPlanRank: provider === "CODEX" ? 1 : 0,
  baseCost: provider === "CODEX" ? 2 : 1,
  options: IMAGE_OPTIONS,
  sort,
  vendor,
  displayName,
  badge,
  etaSec: sec,
  verified: { ok: true, testedAt: TESTED_AT, ms: sec * 1000 },
});

export const TESTED_MODELS: SeedModel[] = [
  tested("AGY", "gemini-3.8-flash-low", "google", "Flash 3.8", "Nhanh", 24, 1),
  tested("AGY", "gemini-4-argon-low", "google", "Argon", "Mới", 33, 3),
  tested("AGY", "claude-sonnet-5-5-low", "anthropic", "Sonnet", "Nhanh", 21, 1),
  tested("AGY", "claude-opus-5-5-low", "anthropic", "Opus", "Đẹp", 20, 2),
  tested("CODEX", "gpt-6-luna", "openai", "Luna 6", "", 42, 1),
  tested("CODEX", "gpt-6.1-sol", "openai", "Sol 6.1", "Cao cấp", 44, 3),
  tested("CODEX", "gpt-6-astra", "openai", "Astra", "", 30, 2),
  tested("CODEX", "gpt-6-sol", "openai", "Sol 6", "", 29, 4),
  tested("CODEX", "gpt-6.1-terra", "openai", "Terra 6.1", "", 32, 5),
  tested("CODEX", "gpt-5.6-sol", "openai", "Sol 5.6", "", 37, 6),
  tested("CODEX", "gpt-5.6-terra", "openai", "Terra 5.6", "", 33, 7),
  tested("CODEX", "gpt-5.6-luna", "openai", "Luna 5.6", "", 29, 8),
];

async function seedTestedModels(): Promise<void> {
  for (const m of TESTED_MODELS) {
    const cur = await db.aiModel.findFirst({
      where: { provider: m.provider, engineModel: m.engineModel, kind: m.kind },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    });
    if (!cur) {
      await db.aiModel.upsert({ where: { name: m.name }, create: m, update: {} });
      continue;
    }
    await db.aiModel.update({
      where: { id: cur.id },
      data: {
        ...(cur.vendor ? {} : { vendor: m.vendor }),
        ...(cur.displayName ? {} : { displayName: m.displayName }),
        ...(cur.badge || !m.badge ? {} : { badge: m.badge }),
        ...(cur.etaSec !== null ? {} : { etaSec: m.etaSec }),
        ...(cur.verified !== null || !m.verified ? {} : { verified: m.verified }),
      },
    });
  }
}

// Tên seed cũ (trước tên ngắn) theo khóa dòng — cùng tên tự sinh cũ thì coi như Admin chưa đổi.
const LEGACY_SEED_NAMES: Record<string, string> = { "Gemini Ảnh": "Gemini 3.8 Flash · Medium", "MUSE Ảnh 2": "Muse Image · TK2" };

// Một lần, chạy lại vô hại: đổi displayName sang tên ngắn CHỈ cho dòng còn tên tự sinh cũ (không đè tên Admin đã sửa);
// badge "Pro" (trùng tên gói) → "Cao cấp"; dòng agy chưa có badge thì điền effort (Nhanh / Cân bằng / Kỹ).
export async function shortenModelNames(): Promise<number> {
  const rows = await db.aiModel.findMany({ select: { id: true, name: true, provider: true, engineModel: true, displayName: true, badge: true } });
  const known = [...KNOWN_MODEL_IDS, ...rows.filter((r) => r.provider !== "LOCAL").map((r) => r.engineModel)];
  let changed = 0;
  for (const r of rows) {
    if (r.provider === "LOCAL") continue;
    const next = shortModelName(r.engineModel, known);
    const old = new Set([legacyModelName(r.engineModel), LEGACY_SEED_NAMES[r.name]].filter(Boolean));
    const data: Prisma.AiModelUpdateInput = {};
    if (next && r.displayName !== next && (!r.displayName || old.has(r.displayName))) data.displayName = next;
    if (r.badge === "Pro") data.badge = "Cao cấp";
    else if (!r.badge && r.provider === "AGY" && effortBadge(r.engineModel)) data.badge = effortBadge(r.engineModel);
    if (Object.keys(data).length) {
      await db.aiModel.update({ where: { id: r.id }, data });
      changed++;
    }
  }
  return changed;
}

const PRESETS: Prisma.PresetCreateInput[] = [
  { kind: "STYLE", name: "Studio", promptSuffix: "clean studio product shot, seamless backdrop, soft box lighting, sharp focus" },
  { kind: "STYLE", name: "Ngoài trời", promptSuffix: "outdoor scene, natural daylight, shallow depth of field" },
  { kind: "STYLE", name: "Trên tay", promptSuffix: "held in a person's hand, close-up, natural skin tones, realistic" },
  { kind: "STYLE", name: "Lifestyle", promptSuffix: "lifestyle photo in a cozy modern home, warm ambient light, candid mood" },
  { kind: "CAMERA", name: "Zoom In", promptSuffix: "slow smooth camera zoom in" },
  { kind: "CAMERA", name: "Zoom Out", promptSuffix: "slow smooth camera zoom out" },
  { kind: "CAMERA", name: "Pan trái", promptSuffix: "camera pans slowly to the left" },
  { kind: "CAMERA", name: "Pan phải", promptSuffix: "camera pans slowly to the right" },
  { kind: "CAMERA", name: "Xoay 360", promptSuffix: "camera orbits 360 degrees around the subject" },
  { kind: "CAMERA", name: "Tĩnh", promptSuffix: "static camera, no camera movement" },
];

const MUSIC_TRACKS = [
  { id: "funky-house", name: "Funky House", file: "/music/music-funky-house.mp3" },
  { id: "energetic-jazz-funk", name: "Energetic Jazz Funk", file: "/music/music-energetic-jazz-funk.mp3" },
  { id: "happy-clap", name: "Happy Clap", file: "/music/music-happy-clap-17s.mp3" },
  { id: "cozy-acoustic", name: "Cozy Acoustic", file: "/music/music-cozy-acoustic.mp3" },
  { id: "lofi-chill", name: "Lofi Chill", file: "/music/music-lofi-chill-loop.mp3" },
];

const SETTINGS: Record<string, Prisma.InputJsonValue> = {
  maintenance: false,
  credit_packs: [
    { credits: 100, price: 49000 },
    { credits: 500, price: 199000 },
    { credits: 1000, price: 349000 },
  ],
  voice_line_cost: 1,
  prompt_writer: { provider: "agy", model: "claude-sonnet-5-5-low" },
  music_tracks: MUSIC_TRACKS,
  ai_gateway: { order: ["agy", "codex", "muse"], agyModel: "claude-sonnet-5-5-low", codexModel: "", timeoutSec: 120 },
  muse_slots: { image: 2, video: 3, chat: 1, gapSec: 15, sendVideoAspect: true },
  story: { planCost: 0.5, maxShots: 8, planner: "muse", assemble: { subtitles: false, keepClipAudio: true } },
};

// Upsert với update rỗng: chạy lại không ghi đè cấu hình Admin đã sửa.
export async function seed(): Promise<void> {
  for (const p of PLANS) {
    await db.plan.upsert({ where: { code: p.code }, create: p, update: {} });
  }
  for (const m of MODELS) {
    await db.aiModel.upsert({ where: { name: m.name }, create: m, update: {} });
  }
  await seedTestedModels();
  await shortenModelNames();
  for (const p of PRESETS) {
    await db.preset.upsert({ where: { kind_name: { kind: p.kind, name: p.name } }, create: p, update: {} });
  }
  for (const [kind, list] of [["STYLE", THEMES], ["CAMERA", CAMERAS]] as const) {
    for (const t of list) {
      const data = { ...t, kind, featured: t.featured ?? false };
      await db.preset.upsert({ where: { kind_name: { kind, name: t.name } }, create: data, update: {} });
    }
  }
  // Preset cũ chưa có slug: bổ sung mô tả, bảng màu, bìa (không đè preset Admin đã sửa).
  for (const [key, meta] of Object.entries(LEGACY_PRESET_META)) {
    const [kind, name] = key.split(":") as ["STYLE" | "CAMERA", string];
    await db.preset.updateMany({ where: { kind, name, slug: null }, data: meta });
  }
  const allSkills = [
    ...SKILLS.map((s) => ({ ...s, category: SKILL_META[s.slug]?.category ?? "", tags: SKILL_META[s.slug]?.tags ?? [] })),
    ...SKILL_LIBRARY,
  ];
  for (const s of allSkills) {
    const cur = await db.promptSkill.findUnique({ where: { slug: s.slug } });
    if (!cur) {
      await db.promptSkill.create({ data: s });
    } else if (cur.updatedAt.getTime() - cur.createdAt.getTime() < 5000) {
      // Admin chưa sửa skill này: cập nhật nội dung theo bản seed mới (giữ bật/tắt + thứ tự).
      await db.promptSkill.update({
        where: { id: cur.id },
        data: { name: s.name, description: s.description, instructions: s.instructions, template: s.template, category: s.category, tags: s.tags },
      });
      await db.$executeRaw`UPDATE prompt_skills SET "updatedAt" = "createdAt" WHERE id = ${cur.id}`;
    } else if (!cur.category && cur.tags.length === 0) {
      await db.$executeRaw`UPDATE prompt_skills SET category = ${s.category}, tags = ${s.tags} WHERE id = ${cur.id}`;
    }
  }
  for (const [key, value] of Object.entries(SETTINGS)) {
    await db.setting.upsert({ where: { key }, create: { key, value }, update: {} });
  }

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("Thiếu SEED_ADMIN_EMAIL hoặc SEED_ADMIN_PASSWORD");
  const admin = await db.user.upsert({
    where: { email },
    create: { email, name: "Admin", role: "ADMIN", passwordHash: await bcrypt.hash(password, 10) },
    update: { role: "ADMIN" },
  });
  const hasActive = await db.subscription.count({ where: { userId: admin.id, status: "ACTIVE" } });
  if (hasActive === 0) await startFree(admin.id);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed.ts")) {
  seed()
    .then(() => console.log("Seed xong"))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
