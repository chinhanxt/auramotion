import type { PromptSkill } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { aiText, type AiProvider, type Breakdown, type GatewayDeps } from "@/server/ai/gateway";
import { guardPrompt } from "@/server/ai/guard";
import { chooseSkillByRules, routeSkill, type RouteInfo } from "@/server/ai/router";
import { presetText, renderTemplate } from "@/server/ai/template";
import { EngineError } from "@/server/engines/types";

export type WritePromptInput = {
  idea: string;
  kind: "image" | "video" | "script";
  aspect?: string;
  durationSec?: number;
  skillId?: string;
  styleId?: string;
  cameraId?: string;
  // Rank gói của người gọi: chặn skill cao hơn gói.
  planRank?: number;
  // Không có skillId: tự chọn skill hợp nhất theo ý tưởng (luồng AI Gateway tự động).
  autoSkill?: boolean;
  // Người dùng gắn ảnh: ảnh tham chiếu (ảnh) hoặc khung đầu (video). AI viết không nhìn thấy ảnh.
  hasRef?: boolean;
};

export type WritePromptResult = {
  // Bộ chọn skill 2 tầng + kiểm prompt (khi tự chọn skill / ảnh-video).
  route?: RouteInfo;
  guard?: { fixes: string[] };
  prompt?: string;
  lines?: string[];
  provider: AiProvider;
  model?: string;
  skill?: { id: string; slug: string; name: string };
  ms?: number;
  breakdown?: Breakdown;
};

const SKILL_KIND = { image: "IMAGE", video: "VIDEO", script: "SCRIPT" } as const;

function buildTask(input: WritePromptInput, style?: string, camera?: string): string {
  const rules: string[] = [];
  if (input.kind === "script") {
    rules.push(
      "Bạn là người viết lời thoại quảng cáo. Từ ý tưởng dưới đây, viết lời thoại đọc trên video quảng cáo bằng tiếng Việt:",
      "- 3 đến 6 câu, mỗi câu tối đa 20 chữ, tự nhiên, dễ đọc thành tiếng.",
      "- Không bịa giá, khuyến mãi hay ưu đãi nếu ý tưởng không nhắc tới.",
    );
    if (input.durationSec) rules.push(`- Tổng thời lượng đọc khoảng ${input.durationSec} giây.`);
    rules.push('Chỉ trả về đúng một đối tượng JSON, không giải thích, không markdown. Dạng: {"lines": ["câu 1", "câu 2"]}');
  } else {
    const target = input.kind === "video" ? "video ngắn" : "ảnh";
    rules.push(
      `Bạn là chuyên gia viết prompt tạo ${target} quảng cáo. Từ ý tưởng dưới đây, viết MỘT prompt tiếng Anh dài 40–80 từ, nêu rõ: chủ thể, bối cảnh, ánh sáng, góc máy, phong cách.`,
    );
    if (input.kind === "video") {
      rules.push("Mô tả thêm chuyển động của chủ thể và ĐÚNG MỘT chuyển động camera chậm, mượt; không zoom vào ra lặp lại.");
    }
    if (style) rules.push(`Phong cách: ${style}.`);
    if (camera && input.kind === "video") rules.push(`Chuyển động camera: ${camera}.`);
    if (input.aspect) rules.push(`Tỷ lệ khung hình: ${input.aspect}.`);
    if (input.kind === "video" && input.durationSec) rules.push(`Thời lượng video: ${input.durationSec} giây.`);
    rules.push('Chỉ trả về đúng một đối tượng JSON, không giải thích, không markdown. Dạng: {"prompt": "..."}');
  }
  return `${rules.join("\n")}\n\nÝ tưởng của người dùng (nằm giữa hai dòng ---):\n---\n${input.idea}\n---`;
}

function parseOutput(data: unknown, text: string, kind: WritePromptInput["kind"]): { prompt?: string; lines?: string[] } {
  const obj = (data ?? {}) as { prompt?: unknown; lines?: unknown };
  if (kind === "script") {
    const lines = Array.isArray(obj.lines)
      ? obj.lines.filter((l): l is string => typeof l === "string").map((l) => l.trim()).filter(Boolean)
      : [];
    if (lines.length > 0) return { lines };
  } else if (typeof obj.prompt === "string" && obj.prompt.trim()) {
    return { prompt: obj.prompt.trim() };
  }
  throw new EngineError("BAD_OUTPUT", `AI trả sai định dạng: ${text.slice(0, 200)}`);
}

export async function loadSkill(skillId: string, kind: PromptSkill["kind"], planRank?: number): Promise<PromptSkill> {
  const skill = await db.promptSkill.findUnique({ where: { id: skillId } });
  if (!skill || !skill.enabled || skill.kind !== kind) throw new AppError("VALIDATION", "Skill không hợp lệ");
  if (planRank !== undefined && skill.minPlanRank > planRank) {
    throw new AppError("PLAN_MODEL", "Gói hiện tại không dùng được skill này");
  }
  return skill;
}

// Chọn skill bằng luật (tầng 1 của bộ chọn) — giữ để tương thích; luồng chính dùng routeSkill (2 tầng).
export function chooseSkill<T extends Pick<PromptSkill, "slug" | "name" | "description" | "sort"> & Partial<Pick<PromptSkill, "category" | "tags">>>(
  skills: T[],
  idea: string,
  opts: { hasRef?: boolean; kind?: "image" | "video" | "script" } = {},
): T | undefined {
  return chooseSkillByRules(skills, idea, opts);
}

const REF_NOTE: Record<"image" | "video", string> = {
  image:
    "The user attached a reference image that the image model will see. You cannot see it: do not invent its exact content; describe how to use it (keep the subject from the reference) and focus on scene, light and style from the idea.",
  video:
    "The user attached an image that Muse will use as the FIRST FRAME. You cannot see it: do not re-describe the whole scene or change the subject; write what moves from that frame (subject motion, secondary motion, the single camera move, light and atmosphere changes).",
};

export async function loadPreset(id: string | undefined, kind: "STYLE" | "CAMERA") {
  if (!id) return null;
  const preset = await db.preset.findUnique({ where: { id } });
  if (!preset || !preset.enabled || preset.kind !== kind) throw new AppError("VALIDATION", "Preset không hợp lệ");
  return preset;
}

// Skill áp cho lần viết: skillId người dùng chọn, hoặc bộ chọn 2 tầng (luật → AI vai `router`) theo ý tưởng.
export async function resolveSkill(
  input: WritePromptInput,
  deps: GatewayDeps = {},
  style?: string,
): Promise<{ skill?: PromptSkill; route?: RouteInfo }> {
  if (input.skillId) return { skill: await loadSkill(input.skillId, SKILL_KIND[input.kind], input.planRank) };
  if (!input.autoSkill) return {};
  const routed = await routeSkill({ kind: input.kind, idea: input.idea, hasRef: input.hasRef, planRank: input.planRank, style }, deps);
  return { skill: routed.skill, route: routed.route };
}

// Dựng câu gửi AI: skill thì instructions (system) + template của skill, không thì hướng dẫn mặc định.
// `skill`: undefined = tự chọn theo input, null = không dùng skill.
export async function buildWriterPrompt(
  input: WritePromptInput,
  skill?: PromptSkill | null,
  deps: GatewayDeps = {},
): Promise<{ prompt: string; system?: string; skill?: PromptSkill; route?: RouteInfo }> {
  const [style, camera] = await Promise.all([loadPreset(input.styleId, "STYLE"), loadPreset(input.cameraId, "CAMERA")]);
  const styleText = presetText(style);
  const cameraText = camera?.promptSuffix;
  const resolved = skill === undefined ? await resolveSkill(input, deps, style?.name) : { skill: skill ?? undefined };
  const chosen = resolved.skill;
  let prompt: string;
  let system: string | undefined;
  if (chosen) {
    system = chosen.instructions;
    prompt = renderTemplate(chosen.template, {
      idea: input.idea,
      style: styleText,
      camera: cameraText,
      aspect: input.aspect,
      duration: input.durationSec,
    });
  } else {
    prompt = buildTask(input, styleText, cameraText);
  }
  if (input.hasRef && input.kind !== "script") prompt = `${prompt}\n\n${REF_NOTE[input.kind]}`;
  return { prompt, system, skill: chosen, ...(resolved.route ? { route: resolved.route } : {}) };
}

// Viết prompt / lời thoại qua AI Gateway (vai `writer` trong ai_roles; setting cũ prompt_writer / ai_gateway
// được đọc tương thích ngược). `skill`: skill đã chọn sẵn (null = không dùng skill). Prompt ảnh/video qua guard.
export async function writePrompt(input: WritePromptInput, deps: GatewayDeps = {}, skill?: PromptSkill | null): Promise<WritePromptResult> {
  const built = await buildWriterPrompt(input, skill, deps);
  let res;
  try {
    res = await aiText({ prompt: built.prompt, system: built.system, json: true, role: "writer" }, deps);
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_GATEWAY") throw new EngineError("PROMPT_WRITER", `AI viết prompt lỗi: ${err.message}`);
    throw err;
  }
  const out = parseOutput(res.data, res.text, input.kind);
  let guard: { fixes: string[] } | undefined;
  if (out.prompt && input.kind !== "script") {
    const g = guardPrompt(input.kind, out.prompt, { allowText: /\b(chữ|text|logo|tiêu đề|slogan)\b/i.test(input.idea) });
    out.prompt = g.prompt;
    guard = { fixes: g.fixes };
  }
  return {
    ...out,
    ...(built.route ? { route: built.route } : {}),
    ...(guard ? { guard } : {}),
    provider: res.provider,
    ...(res.model ? { model: res.model } : {}),
    ms: res.ms,
    ...(res.breakdown ? { breakdown: res.breakdown } : {}),
    ...(built.skill ? { skill: { id: built.skill.id, slug: built.skill.slug, name: built.skill.name } } : {}),
  };
}
