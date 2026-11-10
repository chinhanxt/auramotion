import type { PromptSkill } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { aiText, type AiProvider, type Breakdown, type GatewayDeps } from "@/server/ai/gateway";
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

// Từ khóa (không dấu) gợi ý skill hợp với ý tưởng; skill mới không có ở đây thì dùng tên + mô tả của skill.
const SKILL_HINTS: Record<string, string[]> = {
  "image-product-hero": ["san pham", "chai", "hop qua", "my pham", "nuoc hoa", "dong ho", "doi giay", "giay the thao", "giay dep", "tui xach", "quang cao", "product", "packshot", "ban hang", "shop", "kem duong", "son moi", "serum", "tai nghe", "dien thoai"],
  "image-character-lock": ["nhan vat", "mascot", "linh vat", "character", "con meo", "con cho", "chu meo", "chu cho", "be gai", "be trai", "nhat quan"],
  "image-cinematic-frame": ["dien anh", "canh phim", "cinematic", "khung hinh", "phim", "bau khong khi", "toi", "mua dem"],
  "image-food-drink": ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "banh xeo", "bun cha", "com tam", "xoi", "che", "lau", "nuong", "thit", "gion", "hai san", "ca phe", "cafe", "tra sua", "tra", "nuoc ep", "sinh to", "cocktail", "food", "an uong", "nha hang", "quan an", "com", "boc khoi", "ngon"],
  "image-portrait-fashion": ["chan dung", "nguoi mau", "thoi trang", "ao dai", "outfit", "trang phuc", "portrait", "fashion", "co gai", "chang trai", "lookbook"],
  "image-vietnam-landscape": ["phong canh", "du lich", "ha long", "hoi an", "sapa", "da lat", "ruong bac thang", "bien", "nui", "pho co", "landscape", "travel", "hue", "mien tay"],
  "video-one-move": ["canh", "khung canh", "scene"],
  "video-product-reveal": ["san pham", "chai", "hop qua", "my pham", "nuoc hoa", "doi giay", "giay the thao", "tui xach", "quang cao", "product", "ban hang", "shop", "unbox", "serum", "dong ho"],
  "video-character-motion": ["nhan vat", "mascot", "con meo", "con cho", "chu meo", "chu cho", "be gai", "be trai", "di bo", "chay", "nhay mua", "character"],
  "video-food-motion": ["mon an", "do an", "do uong", "pho", "bun", "banh", "banh mi", "banh xeo", "bun cha", "com tam", "lau", "nuong", "thit", "gion", "ca phe", "cafe", "tra sua", "nuoc ep", "sinh to", "boc khoi", "rot", "food", "nau an", "ngon"],
  "video-travel-scenic": ["phong canh", "du lich", "ha long", "hoi an", "sapa", "da lat", "ruong bac thang", "bien", "nui", "flycam", "drone", "travel", "hoang hon", "binh minh"],
  "video-fashion-showcase": ["thoi trang", "outfit", "trang phuc", "ao dai", "vay", "nguoi mau", "catwalk", "fashion", "lookbook", "mac do"],
  "video-animate-still": [],
};

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Chọn skill hợp nhất cho ý tưởng (nhanh, không gọi AI): đếm từ khóa khớp; hòa thì theo thứ tự `sort`.
// Có ảnh khung đầu cho video thì ưu tiên skill "animate" nếu có.
export function chooseSkill<T extends Pick<PromptSkill, "slug" | "name" | "description" | "sort">>(
  skills: T[],
  idea: string,
  opts: { hasRef?: boolean; kind?: "image" | "video" | "script" } = {},
): T | undefined {
  if (skills.length === 0) return undefined;
  const text = ` ${fold(idea)} `;
  if (opts.hasRef && opts.kind === "video") {
    const animate = skills.find((s) => s.slug === "video-animate-still");
    if (animate) return animate;
  }
  let best: T | undefined;
  let bestScore = 0;
  for (const s of [...skills].sort((a, b) => a.sort - b.sort)) {
    const hints = SKILL_HINTS[s.slug] ?? fold(`${s.name} ${s.description}`).split(" ").filter((w) => w.length > 3);
    let score = 0;
    for (const h of hints) {
      if (!h) continue;
      const hits = text.split(` ${h} `).length - 1;
      score += hits * (h.includes(" ") ? 2 : 1);
    }
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best ?? [...skills].sort((a, b) => a.sort - b.sort)[0];
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

// Skill áp cho lần viết: skillId người dùng chọn, hoặc tự chọn theo ý tưởng (không gọi AI, kết quả ổn định).
export async function resolveSkill(input: WritePromptInput): Promise<PromptSkill | undefined> {
  if (input.skillId) return loadSkill(input.skillId, SKILL_KIND[input.kind], input.planRank);
  if (!input.autoSkill) return undefined;
  const list = await db.promptSkill.findMany({
    where: { kind: SKILL_KIND[input.kind], enabled: true, ...(input.planRank !== undefined ? { minPlanRank: { lte: input.planRank } } : {}) },
  });
  return chooseSkill(list, input.idea, { hasRef: input.hasRef, kind: input.kind });
}

// Dựng câu gửi AI: skill thì instructions (system) + template của skill, không thì hướng dẫn mặc định.
export async function buildWriterPrompt(
  input: WritePromptInput,
  skill?: PromptSkill | null,
): Promise<{ prompt: string; system?: string; skill?: PromptSkill }> {
  const [style, camera] = await Promise.all([loadPreset(input.styleId, "STYLE"), loadPreset(input.cameraId, "CAMERA")]);
  const styleText = presetText(style);
  const cameraText = camera?.promptSuffix;
  const chosen = skill === undefined ? await resolveSkill(input) : (skill ?? undefined);
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
  return { prompt, system, skill: chosen };
}

// Viết prompt / lời thoại qua AI Gateway (vai `writer` trong ai_roles; setting cũ prompt_writer / ai_gateway
// được đọc tương thích ngược). `skill`: skill đã chọn sẵn (null = không dùng skill).
export async function writePrompt(input: WritePromptInput, deps: GatewayDeps = {}, skill?: PromptSkill | null): Promise<WritePromptResult> {
  const built = await buildWriterPrompt(input, skill);
  let res;
  try {
    res = await aiText({ prompt: built.prompt, system: built.system, json: true, role: "writer" }, deps);
  } catch (err) {
    if (err instanceof EngineError && err.code === "AI_GATEWAY") throw new EngineError("PROMPT_WRITER", `AI viết prompt lỗi: ${err.message}`);
    throw err;
  }
  return {
    ...parseOutput(res.data, res.text, input.kind),
    provider: res.provider,
    ...(res.model ? { model: res.model } : {}),
    ms: res.ms,
    ...(res.breakdown ? { breakdown: res.breakdown } : {}),
    ...(built.skill ? { skill: { id: built.skill.id, slug: built.skill.slug, name: built.skill.name } } : {}),
  };
}
