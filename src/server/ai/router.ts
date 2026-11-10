import type { PromptSkill } from "@prisma/client";
import { db } from "@/lib/db";
import { aiText, type GatewayDeps } from "@/server/ai/gateway";

// Bộ chọn skill 2 tầng (~60 skill):
//  Tầng 1 (luật, ~0 ms): chấm điểm từ khóa không dấu → ~10 ứng viên. Thắng áp đảo thì chọn luôn.
//  Tầng 2 (AI nhanh): AI đọc ý tưởng + 10 ứng viên (tên, lĩnh vực, mô tả) → chọn đúng 1 slug.

export type RoutableSkill = Pick<PromptSkill, "slug" | "name" | "description" | "sort"> & Partial<Pick<PromptSkill, "category" | "tags">>;
export type RouteMethod = "fixed" | "rule" | "ai" | "fallback";
export type RouteInfo = { method: RouteMethod; candidates: string[]; chosen: string; ms: number; reason?: string };

export const CANDIDATES = 10;
// Điểm tầng 1 đủ cao và gấp đôi ứng viên thứ hai thì không cần hỏi AI.
const CLEAR_MIN = 3;
const CLEAR_RATIO = 2;

// Từ khóa dự phòng khi skill chưa có `tags` (vd dữ liệu cũ).
const FALLBACK_HINTS: Record<string, string[]> = {
  "image-product-hero": ["san pham", "chai", "my pham", "nuoc hoa", "quang cao", "product", "packshot"],
  "image-character-lock": ["nhan vat", "mascot", "linh vat", "character", "con meo", "chu meo", "chu cho"],
  "image-cinematic-frame": ["dien anh", "canh phim", "cinematic", "khung hinh", "mua dem"],
  "image-food-drink": ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "ca phe", "cafe", "tra sua", "nuoc ep", "com", "thit", "gion", "ngon"],
  "image-portrait-fashion": ["chan dung", "nguoi mau", "thoi trang", "ao dai", "portrait", "fashion", "co gai"],
  "image-vietnam-landscape": ["phong canh", "du lich", "ha long", "hoi an", "sapa", "da lat", "ruong bac thang", "bien", "nui"],
  "video-product-reveal": ["san pham", "chai", "my pham", "nuoc hoa", "quang cao", "product"],
  "video-character-motion": ["nhan vat", "mascot", "con meo", "chu meo", "chu cho", "di bo", "character"],
  "video-food-motion": ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "ca phe", "tra sua", "boc khoi", "rot"],
  "video-travel-scenic": ["phong canh", "du lich", "ha long", "hoi an", "sapa", "ruong bac thang", "flycam", "drone"],
  "video-fashion-showcase": ["thoi trang", "outfit", "trang phuc", "ao dai", "nguoi mau", "lookbook"],
};

export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hintsOf(s: RoutableSkill): string[] {
  if (s.tags && s.tags.length) return s.tags.map(fold);
  return FALLBACK_HINTS[s.slug] ?? fold(`${s.name} ${s.description}`).split(" ").filter((w) => w.length > 3);
}

// Tầng 1: điểm = số lần khớp từ khóa (cụm 2+ từ ×2) + khớp chữ trong tên/lĩnh vực (×0,5).
export function rankSkills<T extends RoutableSkill>(skills: T[], idea: string): { skill: T; score: number }[] {
  const text = ` ${fold(idea)} `;
  const words = new Set(text.trim().split(" ").filter((w) => w.length > 2));
  return skills
    .map((skill) => {
      let score = 0;
      for (const h of hintsOf(skill)) {
        if (!h) continue;
        const hits = text.split(` ${h} `).length - 1;
        score += hits * (h.includes(" ") ? 2 : 1);
      }
      for (const w of fold(`${skill.name} ${skill.category ?? ""}`).split(" ")) if (w.length > 3 && words.has(w)) score += 0.5;
      return { skill, score };
    })
    .sort((a, b) => b.score - a.score || a.skill.sort - b.skill.sort);
}

// Chọn nhanh không AI (giữ cho test + đường dự phòng).
export function chooseSkillByRules<T extends RoutableSkill>(skills: T[], idea: string, opts: { hasRef?: boolean; kind?: string } = {}): T | undefined {
  if (skills.length === 0) return undefined;
  if (opts.hasRef && opts.kind === "video") {
    const animate = skills.find((s) => s.slug === "video-animate-still");
    if (animate) return animate;
  }
  const ranked = rankSkills(skills, idea);
  return ranked[0].score > 0 ? ranked[0].skill : [...skills].sort((a, b) => a.sort - b.sort)[0];
}

const ROUTER_SYSTEM = `You are the skill router of an AI image/video studio. Given the user's request (usually Vietnamese) and a short list of candidate prompt-writing skills, pick the ONE skill whose domain and purpose best match what the user wants to create.
Judge by intent (what will be on screen and why: review, selling, fashion, home goods, film, vlog…), not by single words.
Return strict JSON only: {"slug": "<one candidate slug>", "reason": "<max 12 words, Vietnamese>"}`;

export function buildRouterPrompt(idea: string, candidates: RoutableSkill[], ctx: { kind: string; hasRef?: boolean; style?: string }): string {
  const list = candidates.map((s, i) => `${i + 1}. ${s.slug} — ${s.name}${s.category ? ` [${s.category}]` : ""}: ${s.description}`).join("\n");
  return `Output type: ${ctx.kind}${ctx.hasRef ? " (the user attached a reference image / first frame)" : ""}${ctx.style ? `\nChosen style: ${ctx.style}` : ""}
User request:
---
${idea}
---
Candidates:
${list}`;
}

export function parseRouterAnswer(text: string, candidates: RoutableSkill[]): { slug: string; reason?: string } {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let obj: { slug?: unknown; reason?: unknown } = {};
  if (start !== -1 && end > start) {
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      obj = {};
    }
  }
  let slug = typeof obj.slug === "string" ? obj.slug.trim() : "";
  // AI trả tên / số thứ tự thay vì slug: dò lại trong danh sách.
  if (!candidates.some((c) => c.slug === slug)) {
    const t = text.toLowerCase();
    slug = candidates.find((c) => t.includes(c.slug))?.slug ?? "";
  }
  if (!slug) throw new Error(`router trả slug không hợp lệ: ${text.slice(0, 160)}`);
  return { slug, ...(typeof obj.reason === "string" ? { reason: obj.reason.slice(0, 120) } : {}) };
}

export type RouteInput = { kind: "image" | "video" | "script"; idea: string; hasRef?: boolean; planRank?: number; style?: string };

export async function routeSkill(
  input: RouteInput,
  deps: GatewayDeps & { skills?: PromptSkill[] } = {},
): Promise<{ skill: PromptSkill | undefined; route: RouteInfo }> {
  const started = Date.now();
  const kind = input.kind === "image" ? "IMAGE" : input.kind === "video" ? "VIDEO" : "SCRIPT";
  const skills =
    deps.skills ??
    (await db.promptSkill.findMany({
      where: { kind, enabled: true, ...(input.planRank !== undefined ? { minPlanRank: { lte: input.planRank } } : {}) },
    }));
  const done = (skill: PromptSkill | undefined, method: RouteMethod, candidates: string[], reason?: string) => ({
    skill,
    route: { method, candidates, chosen: skill?.slug ?? "", ms: Date.now() - started, ...(reason ? { reason } : {}) },
  });
  if (skills.length === 0) return done(undefined, "fallback", []);
  if (input.hasRef && input.kind === "video") {
    const animate = skills.find((s) => s.slug === "video-animate-still");
    if (animate) return done(animate, "fixed", [animate.slug]);
  }
  const ranked = rankSkills(skills, input.idea);
  const top = ranked.slice(0, CANDIDATES);
  const [first, second] = top;
  if (first.score >= CLEAR_MIN && first.score >= CLEAR_RATIO * (second?.score ?? 0)) {
    return done(first.skill, "rule", top.map((t) => t.skill.slug));
  }
  if (skills.length === 1) return done(skills[0], "rule", [skills[0].slug]);
  try {
    const cands = top.map((t) => t.skill);
    const res = await aiText(
      {
        prompt: buildRouterPrompt(input.idea, cands, { kind: input.kind, hasRef: input.hasRef, style: input.style }),
        system: ROUTER_SYSTEM,
        validate: (text) => parseRouterAnswer(text, cands),
      },
      deps,
    );
    const pick = res.data as { slug: string; reason?: string };
    return done(cands.find((c) => c.slug === pick.slug), "ai", cands.map((c) => c.slug), pick.reason);
  } catch (err) {
    console.warn(`[router] AI chọn skill lỗi, dùng tầng 1: ${(err as Error).message.slice(0, 200)}`);
    return done(first.score > 0 ? first.skill : skills.sort((a, b) => a.sort - b.sort)[0], "fallback", top.map((t) => t.skill.slug));
  }
}
