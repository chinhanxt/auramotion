import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Job } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { storagePath } from "@/lib/storage";
import { buildAssembleSpec, runAssemble, type ClipFile } from "@/server/engines/assemble";
import { EngineError } from "@/server/engines/types";
import { failJob, finishJob } from "@/server/services/job";
import { generationParamsSchema } from "@/server/services/pricing";
import { getSetting } from "@/server/services/settings";

const MEDIA_PREFIX = "/media/";
const MUSIC_DIR = path.resolve("public/music");

type MusicTrack = { id: string; name: string; file: string };

// Lỗi dữ liệu đầu vào: chạy lại cũng không được, đánh FAILED với mã này.
class InputError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function isFile(p: string): Promise<boolean> {
  return (await fs.stat(p).catch(() => null))?.isFile() ?? false;
}

// URL /media/... → đường dẫn trong STORAGE_DIR (storagePath chặn ../); `prefix` giới hạn thêm theo key.
async function mediaFile(url: string | undefined, code: string, prefix = ""): Promise<string> {
  const key = url?.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null;
  if (!key || !key.startsWith(prefix)) throw new InputError(code);
  let file: string;
  try {
    file = storagePath(key);
  } catch {
    throw new InputError(code);
  }
  if (!(await isFile(file))) throw new InputError(code);
  return file;
}

// Clip phải là job SUCCEEDED, chưa xóa, của chính user, và `index` phải có trong resultUrls.
async function clipFiles(job: Job, clips: { jobId: string; index?: number }[]): Promise<ClipFile[]> {
  const rows = await db.job.findMany({
    where: { id: { in: clips.map((c) => c.jobId) }, userId: job.userId, status: "SUCCEEDED", deletedAt: null },
    select: { id: true, kind: true, resultUrls: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const files: ClipFile[] = [];
  for (const clip of clips) {
    const row = byId.get(clip.jobId);
    if (!row || (row.kind !== "IMAGE" && row.kind !== "VIDEO")) throw new InputError("BAD_CLIP");
    const file = await mediaFile(row.resultUrls[clip.index ?? 0], "BAD_CLIP", `results/${job.userId}/`);
    files.push({ path: file, kind: row.kind === "IMAGE" ? "image" : "video" });
  }
  return files;
}

// Nhạc chỉ lấy từ setting music_tracks, file phải nằm trong public/music.
async function musicFile(musicId: string | undefined): Promise<string | null> {
  if (!musicId) return null;
  const tracks = await getSetting<MusicTrack[]>("music_tracks").catch(() => [] as MusicTrack[]);
  const track = Array.isArray(tracks) ? tracks.find((t) => t.id === musicId) : undefined;
  if (!track || typeof track.file !== "string") throw new InputError("VALIDATION");
  const file = path.resolve("public", track.file.replace(/^\/+/, ""));
  if (!file.startsWith(MUSIC_DIR + path.sep) || !(await isFile(file))) throw new InputError("VALIDATION");
  return file;
}

// Job đã được processJob chuyển sang RUNNING. Mọi lỗi đều đánh FAILED và hoàn Credit (ghép lại từ đầu
// tốn tới 20 phút, không để BullMQ tự chạy lại).
export async function processAssemble(job: Job): Promise<void> {
  const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.mp4`);
  try {
    const parsed = generationParamsSchema.safeParse(job.params);
    if (!parsed.success || parsed.data.kind !== "assemble") throw new InputError("BAD_PARAMS");
    const p = parsed.data;
    const files = await clipFiles(job, p.clips);
    const music = await musicFile(p.musicId);
    const ref = p.voice?.refUrl ? await mediaFile(p.voice.refUrl, "BAD_INPUT", `uploads/${job.userId}/`) : null;
    const { output } = await runAssemble(buildAssembleSpec(p, files, music, ref, out));
    await finishJob(job.id, [{ path: output }]);
  } catch (err) {
    const code = err instanceof InputError || err instanceof EngineError || err instanceof AppError ? err.code : "INTERNAL";
    if (code === "INTERNAL" || code === "ASSEMBLE_FAILED") console.error(`[assemble] job ${job.id} lỗi`, err);
    await failJob(job.id, code);
  } finally {
    await fs.rm(out, { force: true });
  }
}
