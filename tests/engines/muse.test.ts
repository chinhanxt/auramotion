import path from "node:path";
import { describe, expect, inject, it } from "vitest";
import { HttpMuseClient } from "@/server/engines/muse";
import { EngineError } from "@/server/engines/types";

const MUSE_URL = process.env.MUSE_API_URL ?? "http://127.0.0.1:18611";
const SAMPLE_PNG = path.resolve("tests/fixtures/sample.png");

async function waitDone(client: HttpMuseClient, kind: "image" | "video", taskId: string) {
  for (let i = 0; i < 100; i++) {
    const task = await client.getTask(kind, taskId);
    if (task.status !== "queued" && task.status !== "running") return task;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("task chưa xong");
}

async function engineError(p: Promise<unknown>): Promise<EngineError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(EngineError);
  return err as EngineError;
}

describe("HttpMuseClient input", () => {
  it("missing input file throws non-retryable BAD_INPUT", async () => {
    const client = new HttpMuseClient("http://127.0.0.1:9", "dev-muse-key");
    const err = await engineError(
      client.submit({
        kind: "image",
        engineModel: "muse-image",
        prompt: "x",
        aspectRatio: "1:1",
        inputPath: path.resolve("tests/fixtures/does-not-exist.png"),
      }),
    );
    expect(err.code).toBe("BAD_INPUT");
    expect(err.retryable).toBe(false);
  });
});

describe.skipIf(!inject("museMock"))("HttpMuseClient (muse2api mock)", () => {
  const client = new HttpMuseClient(MUSE_URL, "dev-muse-key");

  it("submit image then poll succeeds", async () => {
    const { taskId } = await client.submit({
      kind: "image",
      engineModel: "muse-image",
      prompt: "a red bottle",
      aspectRatio: "9:16",
      imageCount: 2,
      inputPath: SAMPLE_PNG,
    });
    expect(taskId).toMatch(/^task_/);
    const task = await waitDone(client, "image", taskId);
    expect(task.status).toBe("succeeded");
    expect(task.urls).toHaveLength(2);
    const res = await fetch(task.urls[0], { headers: client.authHeaders });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/");
  });

  it("submit video then poll succeeds", async () => {
    const { taskId } = await client.submit({
      kind: "video",
      engineModel: "muse-video",
      prompt: "slow zoom",
      aspectRatio: "16:9",
      durationSec: 5,
    });
    const task = await waitDone(client, "video", taskId);
    expect(task.status).toBe("succeeded");
    expect(task.urls).toHaveLength(1);
    expect(task.urls[0]).toMatch(/\.mp4$/);
  });

  it("bad api key throws non-retryable", async () => {
    const bad = new HttpMuseClient(MUSE_URL, "wrong-key");
    const err = await engineError(bad.submit({ kind: "image", engineModel: "muse-image", prompt: "x", aspectRatio: "1:1" }));
    expect(err.code).toBe("MUSE_AUTH");
    expect(err.retryable).toBe(false);
  });

  it("server down throws retryable", async () => {
    const down = new HttpMuseClient("http://127.0.0.1:1", "dev-muse-key");
    const err = await engineError(down.getTask("image", "task_x"));
    expect(err.retryable).toBe(true);
    expect(await down.health()).toEqual({ ok: false });
  });

  it("health ok", async () => {
    expect(await client.health()).toMatchObject({ ok: true, driver: "mock" });
  });
});
