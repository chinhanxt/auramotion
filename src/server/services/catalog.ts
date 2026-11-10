import type { Prisma, PresetKind, SkillKind } from "@prisma/client";
import { db } from "@/lib/db";
import { getVideoBlocked } from "@/server/engines/muse-block";
import { getActivePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";
import { getStorySetting } from "@/server/services/story";

export type CatalogKind = "image" | "video" | "assemble" | "story";

type MusicTrack = { id: string; name: string; file: string };

const MODEL_KIND = { image: "IMAGE", video: "VIDEO", assemble: "ASSEMBLE", story: "VIDEO" } as const;
const PRESET_KINDS: Record<CatalogKind, PresetKind[]> = { image: ["STYLE"], video: ["CAMERA"], assemble: [], story: ["STYLE", "CAMERA"] };
const SKILL_KINDS: Record<CatalogKind, SkillKind[]> = { image: ["IMAGE"], video: ["VIDEO"], assemble: ["SCRIPT"], story: ["STORY", "SCRIPT"] };

const PRESET_ORDER: Prisma.PresetOrderByWithRelationInput[] = [{ sort: "asc" }, { name: "asc" }];

const PRESET_SELECT = {
  id: true,
  kind: true,
  name: true,
  promptSuffix: true,
  thumbnailUrl: true,
  slug: true,
  category: true,
  description: true,
  cover: true,
  palette: true,
  featured: true,
  sort: true,
} satisfies Prisma.PresetSelect;

export async function getCatalog(userId: string, kind: CatalogKind) {
  const { plan } = await getActivePlan(userId);
  const [models, presets, skills] = await Promise.all([
    db.aiModel.findMany({ where: { kind: MODEL_KIND[kind], enabled: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] }),
    PRESET_KINDS[kind].length
      ? db.preset.findMany({ where: { kind: { in: PRESET_KINDS[kind] }, enabled: true }, orderBy: PRESET_ORDER, select: PRESET_SELECT })
      : [],
    db.promptSkill.findMany({
      where: { kind: { in: SKILL_KINDS[kind] }, enabled: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, kind: true, description: true, minPlanRank: true },
    }),
  ]);
  const wantsMusic = kind === "assemble" || kind === "story";
  const music = wantsMusic ? await getSetting<MusicTrack[]>("music_tracks").catch(() => []) : undefined;
  const usesVideo = kind === "video" || kind === "story";
  const videoUnavailable = usesVideo && models.some((m) => m.provider === "MUSE") ? Boolean(await getVideoBlocked()) : false;
  const story = kind === "story" ? await getStorySetting() : undefined;
  return {
    models: models.map((m) => ({ ...m, options: publicOptions(m.options), locked: m.minPlanRank > plan.rank })),
    presets,
    skills: skills.map(({ minPlanRank, ...s }) => ({ ...s, locked: minPlanRank > plan.rank })),
    plan,
    ...(music ? { music } : {}),
    ...(usesVideo ? { videoUnavailable } : {}),
    ...(story ? { story: { planCost: story.planCost, maxShots: story.maxShots } } : {}),
  };
}

// Công khai (landing): toàn bộ theme STYLE + CAMERA đang bật.
export async function getThemes() {
  const rows = await db.preset.findMany({ where: { enabled: true }, orderBy: PRESET_ORDER, select: PRESET_SELECT });
  return { styles: rows.filter((p) => p.kind === "STYLE"), cameras: rows.filter((p) => p.kind === "CAMERA") };
}

const EXPLORE_PAGE = 24;

// Công khai: job nổi bật đã xong (Admin đánh dấu featured).
export async function getExplore(cursor?: string) {
  const rows = await db.job.findMany({
    where: { featured: true, status: "SUCCEEDED", deletedAt: null, resultUrls: { isEmpty: false } },
    orderBy: [{ finishedAt: "desc" }, { id: "desc" }],
    take: EXPLORE_PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, kind: true, prompt: true, resultUrls: true, params: true },
  });
  const page = rows.slice(0, EXPLORE_PAGE);
  const presetIds = [
    ...new Set(page.map((r) => (r.params as { presetId?: unknown }).presetId).filter((v): v is string => typeof v === "string")),
  ];
  const presets = presetIds.length
    ? new Map((await db.preset.findMany({ where: { id: { in: presetIds } }, select: { id: true, name: true } })).map((p) => [p.id, p.name]))
    : new Map<string, string>();
  return {
    items: page.map((r) => {
      const presetName = presets.get((r.params as { presetId?: string }).presetId ?? "");
      return { id: r.id, kind: r.kind, prompt: r.prompt, resultUrls: r.resultUrls, ...(presetName ? { presetName } : {}) };
    }),
    nextCursor: rows.length > EXPLORE_PAGE ? page[page.length - 1].id : null,
  };
}

// Bỏ cấu hình nội bộ (vd museAccount) trước khi trả options model cho trình duyệt.
function publicOptions(options: unknown): unknown {
  if (!options || typeof options !== "object" || Array.isArray(options)) return options;
  const { museAccount: _hidden, ...rest } = options as Record<string, unknown>;
  return rest;
}
