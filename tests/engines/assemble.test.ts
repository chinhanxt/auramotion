import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma, type JobKind } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { putFile, storagePath } from "@/lib/storage";
import { buildAssembleSpec, runAssemble } from "@/server/engines/assemble";
import { getBalance, hold } from "@/server/services/credit";
import { failJob, processJob } from "@/server/services/job";
import { startFree } from "@/server/services/plan";
import type { AssembleParams } from "@/server/services/pricing";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");
const SAMPLE_MP4 = path.resolve("tests/fixtures/sample.mp4");
const FAKE_VIENEU = path.resolve("tests/fixtures/fake-vieneu-say-assemble.sh");
const MUSIC = path.resolve("public/music/music-happy-clap-17s.mp3");
const SLOW = 120_000;

function probe(file: string): { duration: number; streams: string[] } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", file],
    { encoding: "utf8" },
  );
  const json = JSON.parse(out) as { format: { duration: string }; streams: { codec_type: string }[] };
  return { duration: Number(json.format.duration), streams: json.streams.map((s) => s.codec_type) };
}

let userId: string;
let otherId: string;
let assembleModelId: string;

async function newFreeUser(email: string): Promise<string> {
  const user = await db.user.create({ data: { email, name: email } });
  await startFree(user.id);
  return user.id;
}

// Job ảnh / video đã xong có file kết quả trong storage.
async function doneClip(owner: string, kind: JobKind, src: string, extra: Prisma.JobUpdateInput = {}): Promise<string> {
  const model = await db.aiModel.findFirstOrThrow({ where: { kind } });
  const job = await db.job.create({ data: { userId: owner, modelId: model.id, kind, prompt: "clip", cost: 0 } });
  const url = await putFile(src, `results/${owner}/${job.id}/0${path.extname(src)}`);
  await db.job.update({ where: { id: job.id }, data: { status: "SUCCEEDED", resultUrls: [url], ...extra } });
  return job.id;
}

function params(clips: AssembleParams["clips"], extra: Partial<AssembleParams> = {}): AssembleParams {
  return {
    kind: "assemble",
    modelId: assembleModelId,
    aspect: "9:16",
    clips,
    lines: ["Câu một.", "Câu hai."],
    voice: { preset: "Trúc Ly" },
    musicId: "happy-clap",
    subtitles: true,
    keepClipAudio: false,
    ...extra,
  };
}

// Tạo job ghép PENDING và giữ Credit, không qua createJob (createJob đã tự chặn clip lạ).
async function pendingAssemble(p: AssembleParams): Promise<string> {
  const cost = new Prisma.Decimal(2 + p.lines.length);
  return db.$transaction(async (tx) => {
    const job = await tx.job.create({
      data: { userId, modelId: assembleModelId, kind: "ASSEMBLE", prompt: p.lines.join("\n"), params: p, cost },
    });
    await hold(tx, userId, job.id, cost);
    return job.id;
  });
}

async function balance() {
  const b = await getBalance(userId);
  return { available: b.available.toFixed(2), held: b.held.toFixed(2) };
}

describe("assemble", () => {
  beforeAll(() => {
    vi.stubEnv("VIENEU_BIN", FAKE_VIENEU);
  });

  beforeEach(async () => {
    vi.spyOn(queues.post, "add").mockResolvedValue({} as never);
    await resetDb();
    await seed();
    userId = await newFreeUser("assemble@test.local");
    otherId = await newFreeUser("other@test.local");
    assembleModelId = (await db.aiModel.findFirstOrThrow({ where: { kind: "ASSEMBLE" } })).id;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("buildAssembleSpec maps clips voice music", () => {
    const p = params([{ jobId: "a" }, { jobId: "b", index: 1, in: 0.5, out: 4 }, { jobId: "c", duration: 5 }], {
      keepClipAudio: true,
    });
    const files = [
      { path: "/s/a.webp", kind: "image" as const },
      { path: "/s/b.mp4", kind: "video" as const },
      { path: "/s/c.png", kind: "image" as const },
    ];
    expect(buildAssembleSpec(p, files, "/app/public/music/x.mp3", null, "/tmp/out.mp4")).toEqual({
      aspect: "9:16",
      clips: [
        { type: "image", src: "/s/a.webp", duration: 3 },
        { type: "video", src: "/s/b.mp4", in: 0.5, out: 4 },
        { type: "image", src: "/s/c.png", duration: 5 },
      ],
      clip_audio_db: -6,
      voice: { lines: ["Câu một.", "Câu hai."], voice: "Trúc Ly" },
      music: { src: "/app/public/music/x.mp3", volume_db: -14 },
      subtitles: true,
      out: "/tmp/out.mp4",
    });

    const clone = buildAssembleSpec(
      params([{ jobId: "b" }], { voice: { refUrl: "/media/uploads/u/r.wav" }, musicId: undefined }),
      [{ path: "/s/b.mp4", kind: "video" }],
      null,
      "/s/r.wav",
      "/tmp/o.mp4",
    );
    expect(clone).toEqual({
      aspect: "9:16",
      clips: [{ type: "video", src: "/s/b.mp4", in: 0 }],
      clip_audio_db: null,
      voice: { lines: ["Câu một.", "Câu hai."], ref: "/s/r.wav" },
      subtitles: true,
      out: "/tmp/o.mp4",
    });

    const silent = buildAssembleSpec(params([{ jobId: "a" }], { lines: [] }), [files[0]], null, null, "/tmp/o.mp4");
    expect(silent).not.toHaveProperty("voice");
    expect(silent).not.toHaveProperty("music");
  });

  it(
    "runAssemble produces mp4",
    async () => {
      const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}.mp4`);
      try {
        const spec = buildAssembleSpec(
          params([{ jobId: "a", duration: 4 }, { jobId: "b" }]),
          [
            { path: SAMPLE_PNG, kind: "image" },
            { path: SAMPLE_MP4, kind: "video" },
          ],
          MUSIC,
          null,
          out,
        );
        const result = await runAssemble(spec);
        expect(result.output).toBe(out);
        const info = probe(out);
        expect(info.duration).toBeGreaterThanOrEqual(4);
        expect(result.duration).toBeGreaterThanOrEqual(4);
        expect(info.streams).toEqual(expect.arrayContaining(["video", "audio"]));
      } finally {
        await fs.rm(out, { force: true });
      }
    },
    SLOW,
  );

  it("runAssemble reports script error", async () => {
    const spec = { aspect: "9:16", clips: [{ type: "video", src: "/nonexistent.mp4" }], out: path.join(os.tmpdir(), `aura-out-${randomUUID()}.mp4`) };
    await expect(runAssemble(spec)).rejects.toMatchObject({ code: "ASSEMBLE_FAILED" });
  });

  it(
    "processJob assembles and charges",
    async () => {
      const image = await doneClip(userId, "IMAGE", SAMPLE_PNG);
      const video = await doneClip(userId, "VIDEO", SAMPLE_MP4);
      const jobId = await pendingAssemble(params([{ jobId: image }, { jobId: video, index: 0 }]));
      expect(await balance()).toEqual({ available: "16.00", held: "4.00" });

      await processJob(jobId);

      const done = await db.job.findUniqueOrThrow({ where: { id: jobId } });
      expect(done.error).toBeNull();
      expect(done.status).toBe("SUCCEEDED");
      expect(done.resultUrls).toEqual([`/media/results/${userId}/${jobId}/0.mp4`]);
      const file = storagePath(done.resultUrls[0].slice("/media/".length));
      expect(probe(file).streams).toEqual(expect.arrayContaining(["video", "audio"]));
      expect(await balance()).toEqual({ available: "16.00", held: "0.00" });
    },
    SLOW,
  );

  it(
    "assemble is killed when the job stops running",
    async () => {
      const pids = path.join(os.tmpdir(), `aura-test-pids-${randomUUID()}`);
      vi.stubEnv("FAKE_SLEEP", "60");
      vi.stubEnv("FAKE_PIDS", pids);
      try {
        const clip = await doneClip(userId, "IMAGE", SAMPLE_PNG);
        const jobId = await pendingAssemble(params([{ jobId: clip }], { musicId: undefined }));
        const started = Date.now();
        const run = processJob(jobId, { pollMs: 50 });
        let settled = false;
        void run.finally(() => (settled = true));
        while (!existsSync(pids) && !settled) await new Promise((r) => setTimeout(r, 50));
        await failJob(jobId, "TIMEOUT");
        await run;

        expect(Date.now() - started).toBeLessThan(30_000);
        const pid = Number((await fs.readFile(pids, "utf8")).trim());
        expect(() => process.kill(pid, 0)).toThrow();
        expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "FAILED", error: "TIMEOUT" });
        expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
      } finally {
        vi.stubEnv("FAKE_SLEEP", "");
        await fs.rm(pids, { force: true });
      }
    },
    SLOW,
  );

  it("processAssemble fails on foreign clip", async () => {
    const own = await doneClip(userId, "IMAGE", SAMPLE_PNG);
    const foreign = await doneClip(otherId, "VIDEO", SAMPLE_MP4);
    const jobId = await pendingAssemble(params([{ jobId: own }, { jobId: foreign }]));

    await processJob(jobId);

    const job = await db.job.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toBe("BAD_CLIP");
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("processAssemble rejects unfinished, deleted and out-of-range clips", async () => {
    const running = await doneClip(userId, "IMAGE", SAMPLE_PNG, { status: "RUNNING" });
    const deleted = await doneClip(userId, "IMAGE", SAMPLE_PNG, { deletedAt: new Date() });
    const ok = await doneClip(userId, "IMAGE", SAMPLE_PNG);
    for (const clips of [[{ jobId: running }], [{ jobId: deleted }], [{ jobId: ok, index: 1 }]]) {
      const jobId = await pendingAssemble(params(clips));
      await processJob(jobId);
      expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "FAILED", error: "BAD_CLIP" });
    }
    expect(await balance()).toEqual({ available: "20.00", held: "0.00" });
  });

  it("processAssemble rejects unknown music and music outside public/music", async () => {
    const clip = await doneClip(userId, "IMAGE", SAMPLE_PNG);
    const unknown = await pendingAssemble(params([{ jobId: clip }], { musicId: "nope" }));
    await processJob(unknown);
    expect(await db.job.findUniqueOrThrow({ where: { id: unknown } })).toMatchObject({ status: "FAILED", error: "VALIDATION" });

    await setSetting("music_tracks", [{ id: "evil", name: "Evil", file: "/music/../../package.json" }]);
    const evil = await pendingAssemble(params([{ jobId: clip }], { musicId: "evil" }));
    await processJob(evil);
    expect(await db.job.findUniqueOrThrow({ where: { id: evil } })).toMatchObject({ status: "FAILED", error: "VALIDATION" });
  });

  it("processAssemble rejects voice ref of another user", async () => {
    const clip = await doneClip(userId, "IMAGE", SAMPLE_PNG);
    const ref = await putFile(SAMPLE_MP4, `uploads/${otherId}/${randomUUID()}.m4a`);
    const jobId = await pendingAssemble(params([{ jobId: clip }], { voice: { refUrl: ref } }));
    await processJob(jobId);
    expect(await db.job.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: "FAILED", error: "BAD_INPUT" });
    expect(existsSync(storagePath(ref.slice("/media/".length)))).toBe(true);
  });
});
