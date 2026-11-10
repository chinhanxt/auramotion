import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AiModel, JobKind, ModelProvider, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { redis } from "@/lib/redis";
import { deleteByUrls, putFile, putFromUrl, storagePath } from "@/lib/storage";
import { getFileEngine, getMuse, type FileProvider } from "@/server/engines";
import { validateMedia } from "@/server/engines/media";
import type { HttpMuseClient } from "@/server/engines/muse";
import { getScheduler, type Lease, type MuseScheduler } from "@/server/engines/muse-scheduler";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";
import { museAccountOf } from "@/server/services/job";
import { KNOWN_MODEL_IDS, effortBadge, shortModelName, vendorOf } from "@/server/services/model-naming";

// Admin Model: đồng bộ danh sách model thật (agy ACP, codex các profile, Muse) thành dòng `synced` (mặc định tắt)
// và test vẽ thật 1 ảnh nhỏ / 1 video 5 s bằng đúng dòng model đó (ghi `verified` + ảnh mẫu trong storage).

const IMAGE_RATIOS = ["1:1", "9:16", "16:9", "4:5"];
const VIDEO_RATIOS = ["9:16", "16:9", "1:1"];
const SYNC_SORT = 100;

type Candidate = {
  provider: ModelProvider;
  engineModel: string;
  kind: JobKind;
  description?: string;
};

export type SyncDeps = {
  // id model agy (ACP `session/new.availableModels`).
  agyModels?: () => Promise<{ id: string }[]>;
  // Hợp catalog các profile codex đã đăng nhập (bỏ model ẩn) + danh sách profile đã đăng nhập.
  codexModels?: () => Promise<{ models: { id: string; hidden: boolean; profiles: string[] }[]; profiles: string[] }>;
};

async function defaultAgyModels(): Promise<{ id: string }[]> {
  const { acpModels, getAcpPool } = await import("@/server/ai/acp/runtime");
  await getAcpPool();
  return acpModels();
}

async function defaultCodexModels() {
  const { listCodexProfiles, unionModels } = await import("@/server/ai/codex-profiles");
  const profiles = (await listCodexProfiles()).filter((p) => p.loggedIn);
  return { models: unionModels(profiles), profiles: profiles.map((p) => p.name) };
}

function optionsFor(provider: ModelProvider, kind: JobKind): Prisma.InputJsonObject {
  if (kind === "VIDEO") return { aspectRatios: VIDEO_RATIOS, durations: [5, 10], maxRefs: 1 };
  return { aspectRatios: IMAGE_RATIOS, counts: provider === "MUSE" ? [1, 2, 4] : [1], maxRefs: 1 };
}

function baseCostFor(provider: ModelProvider, kind: JobKind): number {
  if (provider === "MUSE") return kind === "VIDEO" ? 3 : 1;
  return provider === "CODEX" ? 2 : 1;
}

export type SyncResult = {
  created: number;
  existing: number;
  models: { id: string; name: string; provider: ModelProvider; engineModel: string; kind: JobKind; displayName: string; created: boolean }[];
  errors: Partial<Record<"agy" | "codex", string>>;
};

// Mỗi (model × kind hỗ trợ) 1 dòng: agy/codex → IMAGE, muse → IMAGE (muse-image) / VIDEO (muse-video).
// Đã có dòng cùng provider + engineModel + kind (hoặc cùng tên khóa) thì không đụng tới. Chạy lại không tạo trùng.
export async function syncModels(deps: SyncDeps = {}): Promise<SyncResult> {
  const errors: SyncResult["errors"] = {};
  const candidates: Candidate[] = [
    { provider: "MUSE", engineModel: "muse-image", kind: "IMAGE" },
    { provider: "MUSE", engineModel: "muse-video", kind: "VIDEO" },
  ];
  try {
    for (const m of await (deps.agyModels ?? defaultAgyModels)()) candidates.push({ provider: "AGY", engineModel: m.id, kind: "IMAGE" });
  } catch (err) {
    errors.agy = (err as Error).message.slice(0, 300);
  }
  try {
    const { models, profiles } = await (deps.codexModels ?? defaultCodexModels)();
    for (const m of models) {
      if (m.hidden) continue;
      const partial = m.profiles.length < profiles.length;
      candidates.push({ provider: "CODEX", engineModel: m.id, kind: "IMAGE", ...(partial ? { description: `Chỉ có ở profile OpenAI: ${m.profiles.join(", ")}` } : {}) });
    }
  } catch (err) {
    errors.codex = (err as Error).message.slice(0, 300);
  }

  const out: SyncResult = { created: 0, existing: 0, models: [], errors };
  // Đếm phiên bản mỗi dòng model trên danh sách thật vừa lấy (+ danh sách đã biết) để quyết định có giữ số phiên bản không.
  const known = [...KNOWN_MODEL_IDS, ...candidates.map((c) => c.engineModel)];
  const seen = new Set<string>();
  for (const c of candidates) {
    const id = c.engineModel.trim();
    if (!id || id.length > 200) continue;
    const name = `${c.provider.toLowerCase()}:${id}:${c.kind}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const cur = await db.aiModel.findFirst({
      where: { OR: [{ provider: c.provider, engineModel: id, kind: c.kind }, { name }] },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    });
    let row = cur;
    let created = false;
    if (!row) {
      try {
        row = await db.aiModel.create({
          data: {
            name,
            provider: c.provider,
            engineModel: id,
            kind: c.kind,
            minPlanRank: c.provider === "CODEX" ? 1 : 0,
            baseCost: baseCostFor(c.provider, c.kind),
            options: optionsFor(c.provider, c.kind),
            enabled: false,
            sort: SYNC_SORT,
            vendor: vendorOf(c.provider, id),
            displayName: shortModelName(id, known),
            badge: c.provider === "AGY" ? effortBadge(id) : "",
            description: c.description ?? "",
            source: "synced",
          },
        });
        created = true;
      } catch (err) {
        // Hai lần đồng bộ chạy cùng lúc: bên kia vừa tạo.
        row = await db.aiModel.findUnique({ where: { name } });
        if (!row) throw err;
      }
    }
    if (created) out.created++;
    else out.existing++;
    out.models.push({ id: row.id, name: row.name, provider: row.provider, engineModel: row.engineModel, kind: row.kind, displayName: row.displayName, created });
  }
  return out;
}

// ---------- Test vẽ thật ----------

export type Verified = { ok: boolean; testedAt: string; ms: number; error?: string; sampleUrl?: string };

type MuseLike = Pick<HttpMuseClient, "submit" | "getTask" | "authHeaders">;

export type VerifyDeps = {
  engines?: Partial<Record<FileProvider, FileEngine>>;
  muse?: MuseLike;
  scheduler?: MuseScheduler;
  pollMs?: number;
  validate?: (file: string, kind: "image" | "video") => Promise<unknown>;
};

const VERIFY_PROMPT = {
  image: "A small ceramic coffee cup on a wooden table, soft morning window light, simple clean product photo",
  video: "A small ceramic coffee cup on a wooden table, steam rising gently, soft morning light, slow smooth camera push in",
};
const IMAGE_TIMEOUT_MS = 10 * 60_000;
const VIDEO_TIMEOUT_MS = 15 * 60_000;
const SLOT_WAIT_MS = 2 * 60_000;
const LOCK_TTL_SEC = 20 * 60;

const prefix = () => (process.env.NODE_ENV === "test" ? "am:test:" : "am:");
const lockKey = (id: string) => `${prefix()}model:verify:${id}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function extOf(file: string, kind: "image" | "video"): string {
  const ext = path.extname(file.split("?")[0]).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".mp4", ".webm", ".mov"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  return kind === "image" ? ".png" : ".mp4";
}

async function removeTemp(file: string): Promise<void> {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith("aura-out-")) await fs.rm(resolved, { force: true });
}

// Slot Muse (cùng bộ đếm với job thật, tôn trọng tài khoản ghim) để test không chen quá số tab.
async function museLease(scheduler: MuseScheduler, kind: "image" | "video", scope: string | undefined): Promise<Lease> {
  const deadline = Date.now() + SLOT_WAIT_MS;
  for (;;) {
    const got = await scheduler.tryAcquire(kind, { scope });
    if ("lease" in got) return got.lease;
    if (Date.now() >= deadline) throw new EngineError("MUSE_BUSY", "Muse đang bận hết slot, thử lại sau");
    await sleep(Math.min(got.waitMs, 1000));
  }
}

async function runMuse(req: MediaRequest, deps: VerifyDeps, signal: AbortSignal): Promise<{ url: string; headers: Record<string, string> }> {
  const muse = deps.muse ?? getMuse();
  const scheduler = deps.scheduler ?? getScheduler();
  const lease = await museLease(scheduler, req.kind, req.museAccount);
  const done = scheduler.hold(lease);
  try {
    const { taskId } = await muse.submit(req);
    for (;;) {
      if (signal.aborted) throw new EngineError("TIMEOUT", "Muse quá thời gian test");
      const task = await muse.getTask(req.kind, taskId);
      if (task.status === "succeeded") {
        if (!task.urls[0]) throw new EngineError("NO_RESULT", "Muse không trả file");
        return { url: task.urls[0], headers: muse.authHeaders };
      }
      if (task.status === "failed" || task.status === "cancelled") {
        throw new EngineError(task.errorCode || `MUSE_${task.status.toUpperCase()}`, task.error ?? `Muse ${task.status}`);
      }
      await sleep(deps.pollMs ?? 3000);
    }
  } finally {
    await done();
  }
}

function errorText(err: unknown): string {
  if (err instanceof EngineError) return `${err.code}: ${err.message}`.slice(0, 500);
  return `ERROR: ${(err as Error).message ?? String(err)}`.slice(0, 500);
}

// Test vẽ bằng đúng dòng model (provider + engineModel + tài khoản Muse ghim): ảnh 1:1, video Muse 5 s.
// Admin, không trừ Credit. Cùng 1 dòng không chạy 2 lần cùng lúc (khóa Redis, cả app + worker).
export async function verifyModel(id: string, deps: VerifyDeps = {}): Promise<{ verified: Verified; model: AiModel }> {
  const model = await db.aiModel.findUnique({ where: { id } });
  if (!model) throw new AppError("NOT_FOUND", "Không tìm thấy model");
  if (model.kind === "ASSEMBLE" || model.provider === "LOCAL") throw new AppError("VALIDATION", "Model ghép video không cần test vẽ");
  if (model.kind === "VIDEO" && model.provider !== "MUSE") throw new AppError("VALIDATION", "Chỉ test được video Muse");
  const locked = await redis.set(lockKey(id), "1", "EX", LOCK_TTL_SEC, "NX");
  if (locked !== "OK") throw new AppError("CONFLICT", "Model này đang được test, chờ lượt trước xong");
  try {
    const verified = await runVerify(model, deps);
    const old = (model.verified as { sampleUrl?: unknown } | null)?.sampleUrl;
    const updated = await db.aiModel.update({ where: { id }, data: { verified } });
    if (typeof old === "string" && old !== verified.sampleUrl) await deleteByUrls([old]);
    return { verified, model: updated };
  } finally {
    await redis.del(lockKey(id)).catch(() => 0);
  }
}

async function runVerify(model: AiModel, deps: VerifyDeps): Promise<Verified> {
  const kind = model.kind === "VIDEO" ? "video" : "image";
  const museAccount = museAccountOf(model.options);
  const req: MediaRequest = {
    kind,
    engineModel: model.engineModel,
    prompt: VERIFY_PROMPT[kind],
    aspectRatio: kind === "image" ? "1:1" : "9:16",
    ...(kind === "image" ? { imageCount: 1 } : { durationSec: 5 }),
    ...(museAccount ? { museAccount } : {}),
  };
  const signal = AbortSignal.timeout(kind === "image" ? IMAGE_TIMEOUT_MS : VIDEO_TIMEOUT_MS);
  const started = Date.now();
  const testedAt = new Date(started).toISOString();
  const key = (src: string) => `models/${model.id}/sample-${started}${extOf(src, kind)}`;
  let files: string[] = [];
  let sampleUrl: string | undefined;
  try {
    let ms: number;
    if (model.provider === "MUSE") {
      const { url, headers } = await runMuse(req, deps, signal);
      ms = Date.now() - started;
      sampleUrl = await putFromUrl(url, key(url), headers);
    } else {
      const engine = deps.engines?.[model.provider as FileProvider] ?? getFileEngine(model.provider as FileProvider);
      ({ files } = await engine.generate(req, signal));
      ms = Date.now() - started;
      if (!files[0]) throw new EngineError("NO_IMAGE", "Engine chạy xong nhưng không có ảnh");
      sampleUrl = await putFile(files[0], key(files[0]));
    }
    await (deps.validate ?? validateMedia)(storagePath(sampleUrl.slice("/media/".length)), kind);
    return { ok: true, testedAt, ms, sampleUrl };
  } catch (err) {
    if (sampleUrl) await deleteByUrls([sampleUrl]);
    return { ok: false, testedAt, ms: Date.now() - started, error: errorText(err) };
  } finally {
    for (const f of files) await removeTemp(f).catch(() => undefined);
  }
}
