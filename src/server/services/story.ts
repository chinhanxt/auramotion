import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type Job, type Preset, type Story, type StoryStatus } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { storyQueue } from "@/lib/queue";
import { putFile, storagePath } from "@/lib/storage";
import { aiText, extractJson, type AiProvider, type GatewayDeps } from "@/server/ai/gateway";
import { repairStoryJson } from "@/server/ai/json-repair";
import { presetText, renderTemplate } from "@/server/ai/template";
import { extractLastFrame } from "@/server/engines/media";
import { loadPreset, loadSkill } from "@/server/engines/prompt-writer";
import { EngineError } from "@/server/engines/types";
import { chargeFor, holdFor, publishCredit, refundFor } from "@/server/services/credit";
import { assertMuseVideoAvailable, cancelJob, createJob, createJobs, enqueueCreatedJob, failJob } from "@/server/services/job";
import { getActivePlan } from "@/server/services/plan";
import { validateParams, type GenerationParams } from "@/server/services/pricing";
import { getSetting } from "@/server/services/settings";

// Story: 1 ý tưởng → AI (chat chính) lập kịch bản N cảnh → N job VIDEO (chat phụ Muse) → (tùy chọn) tự ghép.

const PAGE_SIZE = 20;
const MEDIA_PREFIX = "/media/";
const ASPECTS = ["9:16", "16:9", "1:1"] as const;
const MAX_PROMPT = 2000;

export type StoryPlanShot = { index: number; title: string; prompt: string; camera?: string; durationSec: number };
export type StoryPlan = { shots: StoryPlanShot[] };

export type StorySetting = {
  planCost: number;
  maxShots: number;
  planner: AiProvider;
  assemble: { musicId?: string; subtitles?: boolean; keepClipAudio?: boolean };
};

export const PLAN_FOLLOW_UP = "Return only valid JSON, shots must be an array.";

export const DEFAULT_STORY_SETTING: StorySetting = {
  planCost: 0.5,
  maxShots: 8,
  planner: "muse",
  assemble: { subtitles: false, keepClipAudio: true },
};

const assembleOpts = z
  .object({
    musicId: z.string().trim().min(1).max(100).optional(),
    subtitles: z.boolean().optional(),
    keepClipAudio: z.boolean().optional(),
  })
  .strict();

export const storyCreateSchema = z.object({
  idea: z.string().trim().min(1, "Hãy nhập ý tưởng").max(2000, "Ý tưởng tối đa 2000 ký tự"),
  title: z.string().trim().max(120).optional(),
  skillId: z.string().min(1).optional(),
  styleId: z.string().min(1).optional(),
  cameraId: z.string().min(1).optional(),
  aspect: z.enum(ASPECTS, { message: "Tỷ lệ khung không hợp lệ" }),
  shotCount: z.number().int().min(2, "Ít nhất 2 cảnh").max(8, "Tối đa 8 cảnh"),
  shotDurationSec: z.union([z.literal(5), z.literal(10)], { message: "Mỗi cảnh 5 hoặc 10 giây" }),
  mode: z.enum(["PARALLEL", "CHAIN"]).default("PARALLEL"),
  autoRun: z.boolean().default(false),
  autoAssemble: z.boolean().default(false),
  assemble: assembleOpts.optional(),
});
export type StoryCreateInput = z.input<typeof storyCreateSchema>;

export const storyPatchSchema = z.object({
  title: z.string().trim().max(120).optional(),
  shots: z
    .array(
      z.object({
        index: z.number().int().min(0),
        title: z.string().trim().min(1).max(120).optional(),
        prompt: z.string().trim().min(1).max(MAX_PROMPT).optional(),
      }),
    )
    .max(8)
    .optional(),
});

// Dùng khi chưa có skill STORY nào trong DB.
const FALLBACK_SYSTEM = `You plan short multi-shot videos for the Muse video model. Each shot prompt is English, 1-3 sentences, exactly one slow smooth camera move, no zoom in/out, no aspect or size words, consecutive shots connected by match-cuts. Return strict JSON only: {"title": "...", "shots": [{"title": "...", "prompt": "...", "camera": "...", "durationSec": number}]}`;
const FALLBACK_TEMPLATE = "Idea: {{idea}}\nStyle: {{style}}\nCamera: {{camera}}\nShots: {{shots}}\nSeconds per shot: {{duration}}";

export async function getStorySetting(): Promise<StorySetting> {
  const raw = await getSetting<Partial<StorySetting>>("story").catch(() => null);
  const s = { ...DEFAULT_STORY_SETTING, ...(raw && typeof raw === "object" ? raw : {}) };
  return {
    ...s,
    planCost: Math.max(0, Number(s.planCost) || 0),
    maxShots: Math.min(8, Math.max(2, Math.floor(Number(s.maxShots) || 8))),
    assemble: { ...DEFAULT_STORY_SETTING.assemble, ...(s.assemble ?? {}) },
  };
}

// ---------- Kiểu trả về ----------

export function toStoryItem(story: Story, cover?: string | null) {
  return {
    id: story.id,
    title: story.title,
    idea: story.idea,
    status: story.status,
    aspect: story.aspect,
    shotCount: story.shotCount,
    shotDurationSec: story.shotDurationSec,
    mode: story.mode,
    autoAssemble: story.autoAssemble,
    plan: story.plan,
    error: story.error,
    finalJobId: story.finalJobId,
    createdAt: story.createdAt,
    ...(cover ? { cover } : {}),
  };
}

async function emitStory(storyId: string): Promise<Story | null> {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (story) {
    await publishEvent(story.userId, "story", {
      id: story.id,
      status: story.status,
      plan: story.plan,
      error: story.error,
      title: story.title,
      finalJobId: story.finalJobId,
    });
  }
  return story;
}

async function setStatus(storyId: string, from: StoryStatus[], data: Prisma.StoryUpdateManyMutationInput): Promise<boolean> {
  const r = await db.story.updateMany({ where: { id: storyId, status: { in: from }, deletedAt: null }, data });
  if (r.count > 0) await emitStory(storyId);
  return r.count > 0;
}

// ---------- Model, kịch bản ----------

async function videoModel() {
  const model =
    (await db.aiModel.findFirst({ where: { kind: "VIDEO", enabled: true, provider: "MUSE" }, orderBy: [{ sort: "asc" }, { name: "asc" }] })) ??
    (await db.aiModel.findFirst({ where: { kind: "VIDEO", enabled: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] }));
  if (!model) throw new AppError("NOT_FOUND", "Chưa có engine video nào đang bật");
  return model;
}

async function assembleModel() {
  const model = await db.aiModel.findFirst({ where: { kind: "ASSEMBLE", enabled: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  if (!model) throw new AppError("NOT_FOUND", "Chưa có engine ghép video nào đang bật");
  return model;
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

// Đọc kịch bản AI trả: chấp nhận chữ có ```json, mảng shots trần, tên trường khác (description/text);
// cắt bớt nếu thừa cảnh, lỗi nếu < 2 cảnh. Thời lượng mỗi cảnh luôn theo story.
export function parseStoryPlan(raw: unknown, opts: { shotCount: number; durationSec: number; strict?: boolean }): { title: string; plan: StoryPlan } {
  let data: unknown = raw;
  if (typeof raw === "string") {
    const direct = extractJson(raw) as { shots?: unknown } | undefined;
    data = direct && Array.isArray(direct.shots) && direct.shots.length ? direct : (repairStoryJson(raw) ?? tryArray(raw));
  }
  const obj = (Array.isArray(data) ? { shots: data } : (data ?? {})) as { title?: unknown; shots?: unknown; scenes?: unknown };
  const list = Array.isArray(obj.shots) ? obj.shots : Array.isArray(obj.scenes) ? obj.scenes : [];
  const shots: StoryPlanShot[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (shots.length >= opts.shotCount) break;
    const s = (typeof item === "string" ? { prompt: item } : (item ?? {})) as Record<string, unknown>;
    const prompt = str(s.prompt ?? s.description ?? s.text, MAX_PROMPT - 200);
    if (!prompt) continue;
    // AI (nhất là Muse sau khi sửa JSON) có lúc lặp lại nguyên một cảnh: bỏ cảnh trùng.
    const key = prompt.toLowerCase().replace(/[^a-z0-9à-ỹ]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const camera = str(s.camera, 80);
    shots.push({
      index: shots.length,
      title: str(s.title, 120) || `Cảnh ${shots.length + 1}`,
      prompt,
      ...(camera ? { camera } : {}),
      durationSec: opts.durationSec,
    });
  }
  if (shots.length < Math.min(2, opts.shotCount) || (opts.strict !== false && shots.length < opts.shotCount)) {
    throw new EngineError("BAD_PLAN", `Kịch bản AI có ${shots.length}/${opts.shotCount} cảnh khác nhau: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return { title: str(obj.title, 120), plan: { shots } };
}

function tryArray(text: string): unknown {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function readPlan(story: Story): StoryPlanShot[] {
  const shots = (story.plan as { shots?: StoryPlanShot[] } | null)?.shots;
  return Array.isArray(shots) ? shots : [];
}

// Prompt job của 1 cảnh: thêm camera / style nếu AI chưa ghi.
export function shotPrompt(shot: StoryPlanShot, style: Pick<Preset, "promptSuffix"> | null): string {
  let p = shot.prompt.trim();
  if (shot.camera && !p.toLowerCase().includes(shot.camera.toLowerCase())) p = `${p.replace(/[.\s]+$/, "")}. ${shot.camera}.`;
  if (style && !p.toLowerCase().includes(style.promptSuffix.slice(0, 24).toLowerCase())) p = `${p} ${style.promptSuffix}`;
  return p.slice(0, MAX_PROMPT);
}

// ---------- Tạo, lập kịch bản ----------

export async function createStory(userId: string, input: StoryCreateInput) {
  const data = storyCreateSchema.parse(input);
  if ((await getSetting<boolean>("maintenance").catch(() => false)) === true) {
    throw new AppError("MAINTENANCE", "Hệ thống đang bảo trì, vui lòng quay lại sau");
  }
  const setting = await getStorySetting();
  const { plan } = await getActivePlan(userId);
  if (data.skillId) await loadSkill(data.skillId, "STORY", plan.rank);
  await Promise.all([loadPreset(data.styleId, "STYLE"), loadPreset(data.cameraId, "CAMERA")]);
  const model = await videoModel();
  // Kiểm gói ngay (thời lượng cảnh, tỷ lệ) để không tốn phí lập kịch bản rồi mới báo lỗi.
  validateParams({ kind: "video", modelId: model.id, prompt: "x", aspectRatio: data.aspect, durationSec: data.shotDurationSec }, model, plan);
  await assertMuseVideoAvailable(model);
  const assemble = { ...setting.assemble, ...(data.assemble ?? {}) };
  if (assemble.musicId) {
    const tracks = await getSetting<{ id: string }[]>("music_tracks").catch(() => []);
    if (!Array.isArray(tracks) || !tracks.some((t) => t.id === assemble.musicId)) throw new AppError("VALIDATION", "Nhạc nền không tồn tại");
  }

  const cost = new Prisma.Decimal(setting.planCost).toDecimalPlaces(2);
  const story = await db.$transaction(async (tx) => {
    const id = `st${randomUUID().replace(/-/g, "").slice(0, 22)}`;
    const created = await tx.story.create({
      data: {
        id,
        userId,
        title: data.title ?? "",
        idea: data.idea,
        skillId: data.skillId ?? null,
        styleId: data.styleId ?? null,
        cameraId: data.cameraId ?? null,
        aspect: data.aspect,
        shotCount: Math.min(data.shotCount, setting.maxShots),
        shotDurationSec: data.shotDurationSec,
        mode: data.mode,
        autoRun: data.autoRun,
        autoAssemble: data.autoAssemble,
        assemble: assemble as Prisma.InputJsonObject,
        threadKey: `story:${id}`,
        planner: setting.planner,
        planCost: cost,
      },
    });
    await holdFor(tx, userId, { storyId: id }, cost);
    return created;
  });
  await emitStory(story.id);
  await publishCredit(userId);
  try {
    await storyQueue.add("plan", { storyId: story.id, action: "plan" }, { attempts: 1, jobId: `plan-${story.id}` });
  } catch (err) {
    console.error(`[story] không đưa được story ${story.id} vào hàng đợi`, err);
    await failPlanning(story.id, "QUEUE_UNAVAILABLE");
    throw new AppError("INTERNAL", "Không đưa được kịch bản vào hàng đợi, Credit đã được hoàn");
  }
  return toStoryItem(story);
}

export async function failPlanning(storyId: string, code: string): Promise<void> {
  const failed = await setStatus(storyId, ["PLANNING"], { status: "FAILED", error: code.slice(0, 200) });
  await refundFor({ storyId });
  const story = await db.story.findUnique({ where: { id: storyId }, select: { userId: true } });
  if (failed && story) await publishCredit(story.userId);
}

export async function planStory(storyId: string, deps: GatewayDeps = {}): Promise<void> {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story || story.deletedAt || story.status !== "PLANNING") return;

  const skill = story.skillId
    ? await db.promptSkill.findUnique({ where: { id: story.skillId } })
    : await db.promptSkill.findFirst({ where: { kind: "STORY", enabled: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] });
  const [style, camera] = await Promise.all([
    story.styleId ? db.preset.findUnique({ where: { id: story.styleId } }) : null,
    story.cameraId ? db.preset.findUnique({ where: { id: story.cameraId } }) : null,
  ]);
  const prompt = renderTemplate(skill?.template ?? FALLBACK_TEMPLATE, {
    idea: story.idea,
    style: presetText(style),
    camera: camera?.promptSuffix,
    aspect: story.aspect,
    duration: story.shotDurationSec,
    shots: story.shotCount,
  });

  let parsed: ReturnType<typeof parseStoryPlan>;
  try {
    const opts = { shotCount: story.shotCount, durationSec: story.shotDurationSec };
    const res = await aiText(
      {
        prompt,
        system: skill?.instructions ?? FALLBACK_SYSTEM,
        validate: (text) => parseStoryPlan(text, opts),
        followUp: `${PLAN_FOLLOW_UP} Exactly ${story.shotCount} distinct shots, no repeated shot.`,
        provider: story.planner as AiProvider,
        threadKey: story.threadKey,
      },
      deps,
    );
    parsed = res.data as ReturnType<typeof parseStoryPlan>;
  } catch (err) {
    console.warn(`[story] lập kịch bản ${storyId} lỗi: ${(err as Error).message.slice(0, 300)}`);
    await failPlanning(storyId, "PLAN_FAILED");
    return;
  }

  const ready = await db.$transaction(async (tx) => {
    const r = await tx.story.updateMany({
      where: { id: storyId, status: "PLANNING", deletedAt: null },
      data: {
        status: "READY",
        plan: parsed.plan as unknown as Prisma.InputJsonObject,
        shotCount: parsed.plan.shots.length,
        title: story.title || parsed.title || story.idea.slice(0, 60),
        error: null,
      },
    });
    if (r.count === 0) return false;
    await chargeFor({ storyId }, tx);
    return true;
  });
  if (!ready) return;
  await emitStory(storyId);
  await publishCredit(story.userId);
  if (story.autoRun) {
    try {
      await renderStory(story.userId, storyId);
    } catch (err) {
      // Giữ READY để người dùng bấm "Tạo video" sau (vd nạp thêm Credit).
      const code = err instanceof AppError || err instanceof EngineError ? err.code : "INTERNAL";
      await db.story.updateMany({ where: { id: storyId, status: "READY" }, data: { error: code } });
      await emitStory(storyId);
    }
  }
}

// ---------- Tạo video các cảnh ----------

async function ownStory(userId: string | undefined, storyId: string): Promise<Story> {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story || story.deletedAt || (userId && story.userId !== userId)) throw new AppError("NOT_FOUND", "Không tìm thấy kịch bản");
  return story;
}

function shotInput(story: Story, modelId: string, shot: StoryPlanShot, style: Preset | null): GenerationParams {
  return {
    kind: "video",
    modelId,
    prompt: shotPrompt(shot, style),
    aspectRatio: story.aspect,
    durationSec: story.shotDurationSec as 5 | 10,
  };
}

export async function renderStory(userId: string, storyId: string) {
  const story = await ownStory(userId, storyId);
  if (story.status !== "READY") throw new AppError("CONFLICT", "Kịch bản chưa sẵn sàng hoặc đã tạo video");
  const shots = readPlan(story);
  if (shots.length < 2) throw new AppError("CONFLICT", "Kịch bản chưa có cảnh");
  const model = await videoModel();
  const style = story.styleId ? await db.preset.findUnique({ where: { id: story.styleId } }) : null;
  if (!(await setStatus(storyId, ["READY"], { status: "RENDERING", error: null }))) {
    throw new AppError("CONFLICT", "Kịch bản đang được tạo video");
  }
  try {
    // PARALLEL: đưa tất cả vào hàng đợi, scheduler Muse giới hạn số chat phụ chạy thật.
    // CHAIN: chỉ cảnh đầu vào hàng đợi; cảnh k+1 chờ khung cuối của cảnh k.
    await createJobs(
      userId,
      storyId,
      shots.map((shot, i) => ({
        input: shotInput(story, model.id, shot, style),
        shotIndex: i,
        enqueue: story.mode === "PARALLEL" || i === 0,
      })),
    );
  } catch (err) {
    const code = err instanceof AppError || err instanceof EngineError ? err.code : "INTERNAL";
    await setStatus(storyId, ["RENDERING"], { status: "READY", error: code });
    throw err;
  }
  return getStory(userId, storyId);
}

function latestByShot(jobs: Job[]): Map<number, Job> {
  const map = new Map<number, Job>();
  for (const j of jobs) {
    if (j.shotIndex === null || j.kind !== "VIDEO") continue;
    const cur = map.get(j.shotIndex);
    if (!cur || j.createdAt > cur.createdAt) map.set(j.shotIndex, j);
  }
  return map;
}

// Khung cuối của cảnh `prev` → ảnh upload của user (dùng làm khung đầu cảnh kế; createJob chấp nhận file này).
async function frameUrl(story: Story, prev: Job): Promise<string> {
  const key = `uploads/${story.userId}/story-${story.id}-f${prev.shotIndex}-${prev.id}.png`;
  const target = storagePath(key);
  if ((await fs.stat(target).catch(() => null))?.isFile()) return `${MEDIA_PREFIX}${key}`;
  const src = prev.resultUrls[0]?.startsWith(MEDIA_PREFIX) ? storagePath(prev.resultUrls[0].slice(MEDIA_PREFIX.length)) : null;
  if (!src) throw new EngineError("FRAME_FAILED", "Cảnh trước không có video");
  const tmp = path.join(os.tmpdir(), `aura-frame-${randomUUID()}.png`);
  try {
    await extractLastFrame(src, tmp);
    return await putFile(tmp, key);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

// Gọi sau mỗi lần job của story đổi trạng thái cuối (hàng đợi story, action advance).
export async function advanceStory(storyId: string): Promise<void> {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story || story.deletedAt || !["RENDERING", "ASSEMBLING", "FAILED"].includes(story.status)) return;
  const jobs = await db.job.findMany({ where: { storyId, deletedAt: null }, orderBy: [{ createdAt: "asc" }] });

  if (story.status === "ASSEMBLING") {
    const final = jobs.filter((j) => j.kind === "ASSEMBLE").at(-1);
    if (!final) return;
    if (final.status === "SUCCEEDED") await setStatus(storyId, ["ASSEMBLING"], { status: "DONE", finalJobId: final.id, error: null });
    else if (final.status === "FAILED" || final.status === "CANCELED") {
      await setStatus(storyId, ["ASSEMBLING"], { status: "FAILED", error: "ASSEMBLE_FAILED" });
    }
    return;
  }

  const shotCount = readPlan(story).length;
  const latest = latestByShot(jobs);

  if (story.mode === "CHAIN") {
    for (let k = 0; k < shotCount - 1; k++) {
      const prev = latest.get(k);
      const next = latest.get(k + 1);
      if (prev?.status !== "SUCCEEDED" || !next || next.status !== "PENDING" || next.queuedAt) continue;
      try {
        await enqueueCreatedJob(next.id, { inputUrl: await frameUrl(story, prev) });
      } catch (err) {
        console.error(`[story] ${storyId} không cắt được khung cuối cảnh ${k}`, err);
        await failJob(next.id, "FRAME_FAILED");
        return;
      }
    }
  }

  const shots = [...Array(shotCount).keys()].map((i) => latest.get(i));
  if (shots.every((j) => j?.status === "SUCCEEDED")) {
    if (story.autoAssemble) await startAssemble(story, shots as Job[]).catch((err) => console.error(`[story] ${storyId} ghép lỗi`, err));
    else await setStatus(storyId, ["RENDERING", "FAILED"], { status: "DONE", error: null });
    return;
  }
  const failed = shots.some((j) => !j || j.status === "FAILED" || j.status === "CANCELED");
  const moving = shots.some((j) => j && (j.status === "RUNNING" || (j.status === "PENDING" && j.queuedAt)));
  if (failed && !moving) await setStatus(storyId, ["RENDERING"], { status: "FAILED", error: "SHOT_FAILED" });
}

async function startAssemble(story: Story, shots: Job[]): Promise<Job> {
  const model = await assembleModel();
  const opts = (story.assemble ?? {}) as StorySetting["assemble"];
  const params: GenerationParams = {
    kind: "assemble",
    modelId: model.id,
    aspect: story.aspect as (typeof ASPECTS)[number],
    clips: shots.map((j) => ({ jobId: j.id })),
    lines: [],
    subtitles: opts.subtitles ?? false,
    keepClipAudio: opts.keepClipAudio ?? true,
    ...(opts.musicId ? { musicId: opts.musicId } : {}),
  };
  if (!(await setStatus(story.id, ["RENDERING", "FAILED", "DONE"], { status: "ASSEMBLING", error: null }))) {
    throw new AppError("CONFLICT", "Kịch bản đang ghép");
  }
  try {
    return await createJob(story.userId, params, { storyId: story.id });
  } catch (err) {
    const code = err instanceof AppError || err instanceof EngineError ? err.code : "INTERNAL";
    await setStatus(story.id, ["ASSEMBLING"], { status: "FAILED", error: code });
    throw err;
  }
}

export async function assembleStory(userId: string, storyId: string) {
  const story = await ownStory(userId, storyId);
  if (!["RENDERING", "FAILED", "DONE"].includes(story.status)) throw new AppError("CONFLICT", "Kịch bản chưa tạo xong các cảnh");
  const jobs = await db.job.findMany({ where: { storyId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const latest = latestByShot(jobs);
  const shots = readPlan(story).map((s) => latest.get(s.index));
  if (shots.length < 2 || !shots.every((j) => j?.status === "SUCCEEDED")) {
    throw new AppError("CONFLICT", "Các cảnh chưa tạo xong hết");
  }
  const job = await startAssemble(story, shots as Job[]);
  return { job };
}

export async function retryShot(userId: string, storyId: string, index: number) {
  const story = await ownStory(userId, storyId);
  if (!["RENDERING", "FAILED"].includes(story.status)) throw new AppError("CONFLICT", "Chỉ quay lại cảnh khi đang tạo video hoặc có cảnh lỗi");
  const jobs = await db.job.findMany({ where: { storyId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  const latest = latestByShot(jobs);
  const old = latest.get(index);
  if (!old) throw new AppError("NOT_FOUND", "Không có cảnh này");
  if (old.status !== "FAILED" && old.status !== "CANCELED") throw new AppError("CONFLICT", "Chỉ quay lại được cảnh lỗi");

  const { inputUrl: _old, ...params } = old.params as GenerationParams & { inputUrl?: string };
  let input = params as GenerationParams;
  let enqueue = true;
  if (story.mode === "CHAIN" && index > 0) {
    const prev = latest.get(index - 1);
    if (prev?.status === "SUCCEEDED") input = { ...input, inputUrl: await frameUrl(story, prev) } as GenerationParams;
    else enqueue = false;
  }
  const [job] = await createJobs(userId, storyId, [{ input, shotIndex: index, enqueue }]);
  await db.job.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
  await setStatus(storyId, ["FAILED", "RENDERING"], { status: "RENDERING", error: null });
  return { job };
}

export async function updateStory(userId: string, storyId: string, input: unknown) {
  const patch = storyPatchSchema.parse(input);
  const story = await ownStory(userId, storyId);
  const data: Prisma.StoryUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.shots?.length) {
    if (story.status !== "READY") throw new AppError("CONFLICT", "Chỉ sửa cảnh khi kịch bản đã sẵn sàng");
    const shots = readPlan(story).map((s) => ({ ...s }));
    for (const edit of patch.shots) {
      const shot = shots.find((s) => s.index === edit.index);
      if (!shot) throw new AppError("VALIDATION", `Không có cảnh ${edit.index + 1}`);
      if (edit.title) shot.title = edit.title;
      if (edit.prompt) shot.prompt = edit.prompt;
    }
    data.plan = { ...(story.plan as object), shots } as Prisma.InputJsonObject;
  }
  await db.story.update({ where: { id: storyId }, data });
  await emitStory(storyId);
  return getStory(userId, storyId);
}

// Hủy job đang chờ (hoàn Credit), ẩn story. Job đang chạy vẫn chạy xong và tính phí như thường.
export async function cancelStory(userId: string | undefined, storyId: string): Promise<void> {
  const story = await ownStory(userId, storyId);
  await db.story.update({ where: { id: storyId }, data: { status: "CANCELED", deletedAt: new Date() } });
  const pending = await db.job.findMany({ where: { storyId, status: "PENDING" }, select: { id: true } });
  for (const { id } of pending) await cancelJob(id, undefined, { quiet: true }).catch(() => undefined);
  await refundFor({ storyId });
  await emitStory(storyId);
  await publishCredit(story.userId);
}

// ---------- Đọc ----------

async function coverOf(storyIds: string[]): Promise<Map<string, string>> {
  const rows = await db.job.findMany({
    where: { storyId: { in: storyIds }, status: "SUCCEEDED", deletedAt: null, kind: "VIDEO" },
    orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }],
    select: { storyId: true, resultUrls: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) if (r.storyId && r.resultUrls[0] && !map.has(r.storyId)) map.set(r.storyId, r.resultUrls[0]);
  return map;
}

export async function getStory(userId: string | undefined, storyId: string, opts: { includeDeleted?: boolean } = {}) {
  const story = await db.story.findUnique({ where: { id: storyId } });
  if (!story || (userId && story.userId !== userId) || (story.deletedAt && !opts.includeDeleted)) {
    throw new AppError("NOT_FOUND", "Không tìm thấy kịch bản");
  }
  const jobs = await db.job.findMany({
    where: { storyId, deletedAt: null },
    orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }],
  });
  const cover = (await coverOf([storyId])).get(storyId);
  return { story: { ...toStoryItem(story, cover), jobs } };
}

export async function listStories(userId: string, cursor?: string) {
  const rows = await db.story.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE_SIZE);
  const covers = await coverOf(page.map((s) => s.id));
  return {
    items: page.map((s) => toStoryItem(s, covers.get(s.id))),
    nextCursor: rows.length > PAGE_SIZE ? page[page.length - 1].id : null,
  };
}

export const adminStoryQuery = z.object({
  status: z.enum(["PLANNING", "READY", "RENDERING", "ASSEMBLING", "DONE", "FAILED", "CANCELED"]).optional(),
  user: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export async function listAdminStories(input: z.input<typeof adminStoryQuery>) {
  const { status, user, page } = adminStoryQuery.parse(input);
  const where: Prisma.StoryWhereInput = {
    ...(status ? { status } : {}),
    ...(user ? { user: { email: { contains: user, mode: "insensitive" } } } : {}),
  };
  const [total, rows] = await Promise.all([
    db.story.count({ where }),
    db.story.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { id: true, email: true } }, _count: { select: { jobs: true } } },
    }),
  ]);
  // Số cảnh đã xong + tổng Credit các job của từng story (cho bảng admin).
  const stats = rows.length
    ? await db.job.groupBy({
        by: ["storyId", "shotIndex", "status"],
        where: { storyId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
        _sum: { cost: true },
      })
    : [];
  const statOf = (id: string) => {
    const mine = stats.filter((x) => x.storyId === id);
    return {
      // Cảnh xong = số shotIndex khác nhau có job SUCCEEDED (bỏ job ghép, lần quay lại trùng cảnh).
      doneCount: new Set(mine.filter((x) => x.status === "SUCCEEDED" && x.shotIndex !== null).map((x) => x.shotIndex)).size,
      cost: mine.reduce((sum, x) => sum + (x._sum.cost?.toNumber() ?? 0), 0),
    };
  };
  return {
    items: rows.map(({ user: u, _count, ...s }) => ({
      ...toStoryItem(s),
      user: u,
      jobCount: _count.jobs,
      ...statOf(s.id),
      deletedAt: s.deletedAt,
      planner: s.planner,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  };
}

// Cron 5 phút: story kẹt PLANNING (worker chết giữa lúc lập kịch bản) → FAILED + hoàn phí;
// story RENDERING / ASSEMBLING lỡ sự kiện advance → chạy lại advance.
export async function sweepStories(now: Date = new Date()): Promise<number> {
  const stuck = await db.story.findMany({
    where: { status: "PLANNING", deletedAt: null, updatedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    select: { id: true },
  });
  for (const { id } of stuck) await failPlanning(id, "TIMEOUT");
  const active = await db.story.findMany({
    where: { status: { in: ["RENDERING", "ASSEMBLING"] }, deletedAt: null, updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    select: { id: true },
  });
  for (const { id } of active) await advanceStory(id);
  return stuck.length;
}
