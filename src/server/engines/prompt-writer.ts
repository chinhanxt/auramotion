import type { PromptSkill } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { aiText, getGatewaySetting, type AiProvider, type GatewayDeps } from "@/server/ai/gateway";
import { presetText, renderTemplate } from "@/server/ai/template";
import { EngineError } from "@/server/engines/types";
import { getSetting } from "@/server/services/settings";

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
};

export type WritePromptResult = { prompt?: string; lines?: string[]; provider: AiProvider };

type PromptWriterSetting = { provider?: "agy" | "codex"; model?: string };

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

export async function loadPreset(id: string | undefined, kind: "STYLE" | "CAMERA") {
  if (!id) return null;
  const preset = await db.preset.findUnique({ where: { id } });
  if (!preset || !preset.enabled || preset.kind !== kind) throw new AppError("VALIDATION", "Preset không hợp lệ");
  return preset;
}

// Viết prompt / lời thoại qua AI Gateway. Có skill thì dùng instructions + template của skill.
// Provider ưu tiên lấy từ setting cũ `prompt_writer` (nếu có), lỗi thì gateway tự thử provider kế.
export async function writePrompt(input: WritePromptInput, deps: GatewayDeps = {}): Promise<WritePromptResult> {
  const writer = await getSetting<PromptWriterSetting>("prompt_writer").catch(() => ({}) as PromptWriterSetting);
  const [style, camera] = await Promise.all([loadPreset(input.styleId, "STYLE"), loadPreset(input.cameraId, "CAMERA")]);
  const styleText = presetText(style);
  const cameraText = camera?.promptSuffix;

  let prompt: string;
  let system: string | undefined;
  if (input.skillId) {
    const skill = await loadSkill(input.skillId, SKILL_KIND[input.kind], input.planRank);
    system = skill.instructions;
    prompt = renderTemplate(skill.template, {
      idea: input.idea,
      style: styleText,
      camera: cameraText,
      aspect: input.aspect,
      duration: input.durationSec,
    });
  } else {
    prompt = buildTask(input, styleText, cameraText);
  }

  const provider = writer.provider === "agy" || writer.provider === "codex" ? writer.provider : undefined;
  const gatewayDeps: GatewayDeps = { ...deps };
  if (!deps.setting && writer.provider === "agy" && writer.model) {
    gatewayDeps.setting = { ...(await getGatewaySetting()), agyModel: writer.model };
  }
  let res;
  try {
    res = await aiText({ prompt, system, json: true, provider }, gatewayDeps);
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_GATEWAY") throw new EngineError("PROMPT_WRITER", `AI viết prompt lỗi: ${err.message}`);
    throw err;
  }
  return { ...parseOutput(res.data, res.text, input.kind), provider: res.provider };
}
