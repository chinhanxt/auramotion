import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as uploadPOST } from "@/app/api/uploads/route";
import { GET as mediaGET } from "@/app/media/[...key]/route";
import { AppError } from "@/lib/errors";
import { deleteByUrls, putFile, putFromUrl, saveUpload, storagePath } from "@/lib/storage";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn(async () => ({ id: "user-storage-test" })) }));

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const USER_ID = "user-storage-test";

let tmpDir: string;

function makeAudio(seconds: number, name: string): Uint8Array<ArrayBuffer> {
  const out = path.join(tmpDir, name);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", String(seconds), out]);
  return new Uint8Array(readFileSync(out));
}

async function expectAppError(p: Promise<unknown>, code: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
}

function media(key: string, headers?: Record<string, string>): Promise<Response> {
  return mediaGET(new Request(`http://localhost/media/${key}`, { headers }), {
    params: Promise.resolve({ key: key.split("/") }),
  });
}

describe("storage", () => {
  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "aura-storage-test-"));
    await fs.rm(path.resolve(process.env.STORAGE_DIR!), { recursive: true, force: true });
  });

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(path.resolve(process.env.STORAGE_DIR!), { recursive: true, force: true });
  });

  it("putFile then storagePath exists", async () => {
    const src = path.join(tmpDir, "a.png");
    await fs.writeFile(src, PNG_MAGIC);
    const url = await putFile(src, "results/u1/j1/0.png");
    expect(url).toBe("/media/results/u1/j1/0.png");
    const dest = storagePath("results/u1/j1/0.png");
    expect(dest).toBe(path.join(path.resolve(process.env.STORAGE_DIR!), "results/u1/j1/0.png"));
    expect(await fs.readFile(dest)).toEqual(PNG_MAGIC);
  });

  it("rejects path traversal key", () => {
    for (const key of ["../x", "a/../../x", "/etc/passwd", "a\\..\\x", "a\0b", "", ".."]) {
      expect(() => storagePath(key), JSON.stringify(key)).toThrow(AppError);
    }
  });

  it("putFromUrl downloads with headers", async () => {
    let auth: string | undefined;
    const server: Server = createServer((req, res) => {
      auth = req.headers.authorization;
      if (req.url === "/missing") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "image/webp" }).end("webp-bytes");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const url = await putFromUrl(`${base}/f.webp`, "results/u1/j2/0.webp", { Authorization: "Bearer k" });
      expect(url).toBe("/media/results/u1/j2/0.webp");
      expect(auth).toBe("Bearer k");
      expect(await fs.readFile(storagePath("results/u1/j2/0.webp"), "utf8")).toBe("webp-bytes");
      await expectAppError(putFromUrl(`${base}/missing`, "results/u1/j2/1.webp"), "ENGINE");
      expect(existsSync(storagePath("results/u1/j2/1.webp"))).toBe(false);
    } finally {
      server.close();
    }
  });

  it("saveUpload stores image with server-chosen extension", async () => {
    const file = new File([PNG_MAGIC, Buffer.alloc(100)], "evil.php", { type: "image/png" });
    const { url, path: p } = await saveUpload(USER_ID, file, "image");
    expect(url).toMatch(new RegExp(`^/media/uploads/${USER_ID}/[0-9a-f-]{36}\\.png$`));
    expect(p).toBe(storagePath(url.slice("/media/".length)));
    expect(existsSync(p)).toBe(true);
  });

  it("saveUpload rejects gif and >10MB", async () => {
    const gif = new File([Buffer.from("GIF89a"), Buffer.alloc(100)], "a.gif", { type: "image/gif" });
    await expectAppError(saveUpload(USER_ID, gif, "image"), "VALIDATION");

    const gifAsPng = new File([Buffer.from("GIF89a"), Buffer.alloc(100)], "a.png", { type: "image/png" });
    await expectAppError(saveUpload(USER_ID, gifAsPng, "image"), "VALIDATION");

    const big = new File([PNG_MAGIC, Buffer.alloc(10 * 1024 * 1024)], "big.png", { type: "image/png" });
    await expectAppError(saveUpload(USER_ID, big, "image"), "VALIDATION");
  });

  it("saveUpload rejects audio shorter than 3s", async () => {
    const short = new File([makeAudio(1, "short.wav")], "short.wav", { type: "audio/wav" });
    await expectAppError(saveUpload(USER_ID, short, "audio"), "VALIDATION");
    const dir = storagePath(`uploads/${USER_ID}`);
    const left = existsSync(dir) ? (await fs.readdir(dir)).filter((f) => f.endsWith(".wav")) : [];
    expect(left).toEqual([]);

    const ok = new File([makeAudio(4, "ok.wav")], "ok.wav", { type: "audio/wav" });
    const { url } = await saveUpload(USER_ID, ok, "audio");
    expect(url).toMatch(/\.wav$/);
  });

  it("deleteByUrls removes files", async () => {
    const src = path.join(tmpDir, "d.png");
    await fs.writeFile(src, PNG_MAGIC);
    const a = await putFile(src, "results/u1/j3/0.png");
    const b = await putFile(src, "results/u1/j3/1.png");
    await deleteByUrls([a, b, "/media/results/u1/j3/none.png", "/media/../x", "https://example.com/x.png"]);
    expect(existsSync(storagePath("results/u1/j3/0.png"))).toBe(false);
    expect(existsSync(storagePath("results/u1/j3/1.png"))).toBe(false);
  });

  it("media route serves file with content type", async () => {
    const src = path.join(tmpDir, "v.mp4");
    await fs.writeFile(src, Buffer.from("0123456789"));
    await putFile(src, "results/u1/j4/0.mp4");
    const res = await media("results/u1/j4/0.mp4");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(await res.text()).toBe("0123456789");
  });

  it("media route returns 206 for Range", async () => {
    const res = await media("results/u1/j4/0.mp4", { Range: "bytes=2-5" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");

    const suffix = await media("results/u1/j4/0.mp4", { Range: "bytes=-3" });
    expect(suffix.status).toBe(206);
    expect(await suffix.text()).toBe("789");

    const open = await media("results/u1/j4/0.mp4", { Range: "bytes=7-" });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 7-9/10");
    expect(await open.text()).toBe("789");

    const bigSuffix = await media("results/u1/j4/0.mp4", { Range: "bytes=-500" });
    expect(bigSuffix.headers.get("content-range")).toBe("bytes 0-9/10");
    expect(await bigSuffix.text()).toBe("0123456789");

    const bad = await media("results/u1/j4/0.mp4", { Range: "bytes=20-" });
    expect(bad.status).toBe(416);
    expect(bad.headers.get("content-range")).toBe("bytes */10");

    for (const ignored of ["bytes=0-1,4-5", "bytes=5-2", "items=0-1"]) {
      const res = await media("results/u1/j4/0.mp4", { Range: ignored });
      expect(res.status, ignored).toBe(200);
      expect(await res.text()).toBe("0123456789");
    }
  });

  it("media route returns 404 when missing", async () => {
    expect((await media("results/u1/none.mp4")).status).toBe(404);
    expect((await media("../package.json")).status).toBe(404);
    expect((await media("results/u1")).status).toBe(404);
  });

  it("upload route rejects oversized body before reading it", async () => {
    const form = new FormData();
    form.set("kind", "image");
    form.set("file", new File([PNG_MAGIC, Buffer.alloc(100)], "a.png", { type: "image/png" }));
    const big = await uploadPOST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body: form,
        headers: { "content-length": String(11 * 1024 * 1024) },
      }),
    );
    expect(big.status).toBe(400);
    expect((await big.json()).error.code).toBe("VALIDATION");

    const okReq = new Request("http://localhost/api/uploads", { method: "POST", body: form });
    const body = await okReq.arrayBuffer();
    const ok = await uploadPOST(
      new Request("http://localhost/api/uploads", {
        method: "POST",
        body,
        headers: { "content-type": okReq.headers.get("content-type")!, "content-length": String(body.byteLength) },
      }),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).url).toMatch(/^\/media\/uploads\/user-storage-test\/.+\.png$/);
  });
});
