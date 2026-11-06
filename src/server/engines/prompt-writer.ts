import { agyText } from "@/server/engines/agy";
import { codexText } from "@/server/engines/codex";
import { EngineError } from "@/server/engines/types";
import { getSetting } from "@/server/services/settings";

export type WritePromptInput = {
  idea: string;
  kind: "image" | "video" | "script";
  aspect?: string;
  durationSec?: number;
};

type Provider = "agy" | "codex";
type PromptWriterSetting = { provider?: Provider; model?: string };

const DEFAULT_AGY_MODEL = "claude-sonnet-5-5-low";

function buildTask(input: WritePromptInput): string {
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
    if (input.kind === "video") rules.push("Mô tả thêm chuyển động camera và chuyển động của chủ thể.");
    if (input.aspect) rules.push(`Tỷ lệ khung hình: ${input.aspect}.`);
    if (input.kind === "video" && input.durationSec) rules.push(`Thời lượng video: ${input.durationSec} giây.`);
    rules.push('Chỉ trả về đúng một đối tượng JSON, không giải thích, không markdown. Dạng: {"prompt": "..."}');
  }
  return `${rules.join("\n")}\n\nÝ tưởng của người dùng (nằm giữa hai dòng ---):\n---\n${input.idea}\n---`;
}

function parseOutput(text: string, kind: WritePromptInput["kind"]): { prompt?: string; lines?: string[] } {
  const unfenced = text.replace(/```(?:json)?/gi, "");
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  let data: unknown;
  try {
    data = start !== -1 && end > start ? JSON.parse(unfenced.slice(start, end + 1)) : null;
  } catch {
    data = null;
  }
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

// Viết prompt / lời thoại bằng engine trong setting `prompt_writer`; engine đó lỗi thì thử engine còn lại.
export async function writePrompt(input: WritePromptInput): Promise<{ prompt?: string; lines?: string[] }> {
  const setting = await getSetting<PromptWriterSetting>("prompt_writer").catch(() => ({}) as PromptWriterSetting);
  const primary: Provider = setting.provider === "codex" ? "codex" : "agy";
  const agyModel = primary === "agy" && setting.model ? setting.model : DEFAULT_AGY_MODEL;
  const task = buildTask(input);
  const run = (p: Provider) => (p === "agy" ? agyText(task, agyModel) : codexText(task));

  let text: string;
  try {
    text = await run(primary);
  } catch (first) {
    const fallback: Provider = primary === "agy" ? "codex" : "agy";
    console.warn(`[prompt-writer] ${primary} lỗi, thử ${fallback}: ${(first as Error).message.slice(0, 300)}`);
    try {
      text = await run(fallback);
    } catch (second) {
      throw new EngineError("PROMPT_WRITER", `AI viết prompt lỗi: ${(first as Error).message} | ${(second as Error).message}`);
    }
  }
  return parseOutput(text, input.kind);
}
