import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { extractLastFrame, probeMedia, validateMedia } from "@/server/engines/media";

const MP4 = path.resolve("tests/fixtures/sample.mp4");
const PNG = path.resolve("tests/fixtures/sample.png");
let dir: string;

describe("media validation", () => {
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-media-test-"));
  });

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("accepts good video and image", async () => {
    await validateMedia(MP4, "video");
    await validateMedia(PNG, "image");
    expect((await probeMedia(MP4))?.duration).toBeGreaterThan(0);
  });

  it("rejects truncated mp4 and fake image as retryable BAD_MEDIA", async () => {
    const cut = path.join(dir, "cut.mp4");
    await fs.writeFile(cut, (await fs.readFile(MP4)).subarray(0, 9000));
    const fake = path.join(dir, "fake.png");
    await fs.writeFile(fake, "<html>not an image</html>");
    for (const [file, kind] of [
      [cut, "video"],
      [fake, "image"],
      [PNG, "video"],
    ] as const) {
      await expect(validateMedia(file, kind)).rejects.toMatchObject({ code: "BAD_MEDIA", retryable: true });
    }
  });

  it("extracts the last frame as an image", async () => {
    const out = path.join(dir, "last.png");
    await extractLastFrame(MP4, out);
    await validateMedia(out, "image");
  });
});
