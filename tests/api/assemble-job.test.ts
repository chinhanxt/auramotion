import path from "node:path";
import { Prisma, type JobKind, type User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { queues } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { putFile } from "@/lib/storage";
import { getBalance } from "@/server/services/credit";
import { activatePlan, startFree } from "@/server/services/plan";
import type { AssembleParams } from "@/server/services/pricing";
import { setSetting } from "@/server/services/settings";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");
const SAMPLE_MP4 = path.resolve("tests/fixtures/sample.mp4");
const SAMPLE_REF = path.resolve("tests/fixtures/sample.mp4");

const current: { user: User | null } = { user: null };

vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    requireUser: async () => {
      if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
      return current.user;
    },
  };
});

const { POST } = await import("@/app/api/jobs/route");

let user: User;
let other: User;
let modelId: string;

async function newUser(email: string): Promise<User> {
  const u = await db.user.create({ data: { email, name: email } });
  await startFree(u.id);
  return u;
}

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
    modelId,
    aspect: "9:16",
    clips,
    lines: ["Câu một.", "Câu hai.", "Câu ba."],
    voice: { preset: "Trúc Ly" },
    musicId: "happy-clap",
    subtitles: true,
    keepClipAudio: false,
    ...extra,
  };
}

async function post(body: unknown): Promise<{ status: number; body: { id?: string; status?: string; cost?: string; error?: { code: string } } }> {
  const res = await POST(
    new Request("http://localhost/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

async function expectRejected(body: unknown, code: string): Promise<void> {
  const res = await post(body);
  expect(res.body.error?.code).toBe(code);
  expect(await db.job.count({ where: { kind: "ASSEMBLE", status: "PENDING" } })).toBe(0);
  expect(queues.post.add).not.toHaveBeenCalled();
}

describe("POST /api/jobs kind assemble", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    for (const q of Object.values(queues)) vi.spyOn(q, "add").mockResolvedValue({} as never);
    await resetDb();
    await seed();
    await setSetting("maintenance", false);
    user = await newUser("assemble-api@test.local");
    other = await newUser("assemble-other@test.local");
    current.user = user;
    modelId = (await db.aiModel.findFirstOrThrow({ where: { kind: "ASSEMBLE" } })).id;
  });

  afterAll(async () => {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await redis.quit();
    await db.$disconnect();
  });

  it("creates PENDING job costing 5 for 3 lines and queues it on post", async () => {
    const image = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    const video = await doneClip(user.id, "VIDEO", SAMPLE_MP4);
    const res = await post(params([{ jobId: image, duration: 3 }, { jobId: video, in: 0, out: 2 }]));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING");
    expect(Number(res.body.cost)).toBe(5);
    expect(queues.post.add).toHaveBeenCalledWith("assemble", { jobId: res.body.id }, { priority: 10, jobId: res.body.id });
    expect(queues.muse.add).not.toHaveBeenCalled();
    const balance = await getBalance(user.id);
    expect(balance.held.toFixed(2)).toBe("5.00");
  });

  it("assemble rejects foreign job", async () => {
    const foreign = await doneClip(other.id, "IMAGE", SAMPLE_PNG);
    await expectRejected(params([{ jobId: foreign }]), "VALIDATION");

    const own = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    await db.job.update({ where: { id: own }, data: { status: "RUNNING" } });
    await expectRejected(params([{ jobId: own }]), "VALIDATION");
  });

  it("assemble rejects deleted clip, missing index and assemble result", async () => {
    const deleted = await doneClip(user.id, "IMAGE", SAMPLE_PNG, { deletedAt: new Date() });
    await expectRejected(params([{ jobId: deleted }]), "VALIDATION");

    const image = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    await expectRejected(params([{ jobId: image, index: 1 }]), "VALIDATION");

    const assembled = await doneClip(user.id, "ASSEMBLE", SAMPLE_MP4);
    await expectRejected(params([{ jobId: assembled }]), "VALIDATION");

    await expectRejected(params([{ jobId: "no-such-job" }]), "VALIDATION");
  });

  it("assemble rejects unknown music", async () => {
    const image = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    await expectRejected(params([{ jobId: image }], { musicId: "no-such-track" }), "VALIDATION");
  });

  it("assemble rejects foreign voice ref", async () => {
    await activatePlan(user.id, "pro", "MONTH");
    const image = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    const foreignRef = await putFile(SAMPLE_REF, `uploads/${other.id}/ref.mp4`);
    await expectRejected(params([{ jobId: image }], { voice: { refUrl: foreignRef } }), "VALIDATION");
    await expectRejected(params([{ jobId: image }], { voice: { refUrl: `/media/uploads/${user.id}/../${other.id}/ref.mp4` } }), "VALIDATION");
    await expectRejected(params([{ jobId: image }], { voice: { refUrl: `/media/uploads/${user.id}/missing.wav` } }), "VALIDATION");

    const ownRef = await putFile(SAMPLE_REF, `uploads/${user.id}/ref.mp4`);
    const res = await post(params([{ jobId: image }], { voice: { refUrl: ownRef } }));
    expect(res.body.status).toBe("PENDING");
  });

  it("free user with voice.refUrl gets PLAN_MODEL", async () => {
    const image = await doneClip(user.id, "IMAGE", SAMPLE_PNG);
    const ownRef = await putFile(SAMPLE_REF, `uploads/${user.id}/ref.mp4`);
    await expectRejected(params([{ jobId: image }], { voice: { refUrl: ownRef } }), "PLAN_MODEL");
  });
});
