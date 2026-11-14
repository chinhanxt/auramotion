import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Ảnh thu nhỏ (`?w=`) và khung hình xem trước của video (`?poster=`): sinh 1 lần, lưu trên đĩa, phục vụ với cache dài hạn.
// File gốc luôn bất biến theo URL (đường dẫn có mã job / mốc thời gian) nên khóa cache = đường dẫn + mtime + size + cỡ.

export const THUMB_WIDTHS = [160, 240, 320, 360, 480, 640, 960, 1280] as const;
const MAX_PARALLEL = 3;

export function snapWidth(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return THUMB_WIDTHS.find((w) => w >= n) ?? THUMB_WIDTHS[THUMB_WIDTHS.length - 1];
}

export function thumbDir(): string {
  const storage = path.resolve(process.env.STORAGE_DIR ?? "./data/storage");
  return path.join(path.dirname(storage), "cache", "thumbs");
}

let running = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

const inflight = new Map<string, Promise<string>>();

function ffmpegFrame(src: string, out: string, width: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-y", "-ss", "0.3", "-i", src, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-c:v", "libwebp", "-quality", "70", out], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const timer = setTimeout(() => p.kill("SIGKILL"), 20_000);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}: ${err.slice(-200)}`));
    });
  });
}

// Trả đường dẫn file đã sinh (webp). Lỗi (file hỏng / không đọc được) → ném lỗi để route trả file gốc.
export async function ensureThumb(srcPath: string, kind: "image" | "poster", width: number): Promise<{ file: string; etag: string }> {
  const stat = await fs.stat(srcPath);
  const key = createHash("sha1").update(`${srcPath}|${stat.mtimeMs}|${stat.size}|${kind}|${width}`).digest("hex");
  const dir = thumbDir();
  const file = path.join(dir, key.slice(0, 2), `${key}.webp`);
  const etag = `"${key.slice(0, 20)}"`;
  const exists = await fs.stat(file).then((s) => s.size > 0, () => false);
  if (exists) return { file, etag };
  let job = inflight.get(key);
  if (!job) {
    job = slot(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      if (kind === "poster") await ffmpegFrame(srcPath, tmp, width);
      else await sharp(srcPath, { failOn: "none" }).rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 72, effort: 3 }).toFile(tmp);
      await fs.rename(tmp, file);
      return file;
    }).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  await job;
  return { file, etag };
}
