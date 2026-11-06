import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { promisify } from "node:util";
import { AppError } from "@/lib/errors";

const execFileAsync = promisify(execFile);

const MEDIA_PREFIX = "/media/";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const AUDIO_MIN_SEC = 3;
const AUDIO_MAX_SEC = 30;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

type UploadKind = "image" | "audio";

// MIME được chấp nhận (kể cả tên gọi khác của trình duyệt) → định dạng chuẩn.
const ALLOWED_MIME: Record<UploadKind, Record<string, string>> = {
  image: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" },
  audio: {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/webm": "webm",
  },
};

function storageRoot(): string {
  return path.resolve(process.env.STORAGE_DIR || "./data/storage");
}

export function storagePath(key: string): string {
  if (!key || key.includes("\0") || key.includes("\\") || key.startsWith("/") || key.split("/").includes("..")) {
    throw new AppError("VALIDATION", "Đường dẫn file không hợp lệ");
  }
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) {
    throw new AppError("VALIDATION", "Đường dẫn file không hợp lệ");
  }
  return full;
}

function keyFromUrl(url: string): string | null {
  return url.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null;
}

async function prepareDest(key: string): Promise<{ dest: string; tmp: string }> {
  const dest = storagePath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return { dest, tmp: `${dest}.${randomUUID()}.tmp` };
}

export async function putFile(srcPath: string, key: string): Promise<string> {
  const { dest, tmp } = await prepareDest(key);
  try {
    await fs.copyFile(srcPath, tmp);
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return `${MEDIA_PREFIX}${key}`;
}

export async function putFromUrl(srcUrl: string, key: string, headers?: Record<string, string>): Promise<string> {
  const { dest, tmp } = await prepareDest(key);
  const res = await fetch(srcUrl, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok || !res.body) {
    throw new AppError("ENGINE", `Không tải được file kết quả (HTTP ${res.status})`);
  }
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(tmp));
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return `${MEDIA_PREFIX}${key}`;
}

function ascii(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString("latin1");
}

// Nhận diện định dạng thật theo magic bytes.
function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "webp";
  if (buf.length >= 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "wav";
  if (buf.length >= 3 && ascii(buf, 0, 3) === "ID3") return "mp3";
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  if (buf.length >= 8 && ascii(buf, 4, 8) === "ftyp") return "m4a";
  if (buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "webm";
  return null;
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      { timeout: 15_000 },
    );
    const sec = Number.parseFloat(stdout.trim());
    if (Number.isFinite(sec)) return sec;
    // WebM ghi từ MediaRecorder thường không có duration trong header: giải mã để đo.
    const { stderr } = await execFileAsync("ffmpeg", ["-v", "quiet", "-stats", "-i", filePath, "-f", "null", "-"], {
      timeout: 30_000,
    });
    const times = [...stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    const last = times.at(-1);
    if (last) return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
  } catch {
    // rơi xuống lỗi chung bên dưới
  }
  throw new AppError("VALIDATION", "Không đọc được file âm thanh");
}

export async function saveUpload(
  userId: string,
  file: File,
  kind: UploadKind,
): Promise<{ url: string; path: string }> {
  if (file.size === 0) throw new AppError("VALIDATION", "File rỗng");
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "File vượt quá 10 MB");

  const mime = file.type.split(";")[0].trim().toLowerCase();
  const expected = ALLOWED_MIME[kind][mime];
  const buf = Buffer.from(await file.arrayBuffer());
  if (!expected || sniff(buf) !== expected) {
    throw new AppError(
      "VALIDATION",
      kind === "image" ? "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP" : "Chỉ hỗ trợ âm thanh WAV, MP3, M4A hoặc WebM",
    );
  }

  const key = `uploads/${userId}/${randomUUID()}.${expected}`;
  const { dest, tmp } = await prepareDest(key);
  try {
    await fs.writeFile(tmp, buf);
    if (kind === "audio") {
      const sec = await probeDuration(tmp);
      if (sec < AUDIO_MIN_SEC || sec > AUDIO_MAX_SEC) {
        throw new AppError("VALIDATION", `Mẫu giọng phải dài từ ${AUDIO_MIN_SEC} đến ${AUDIO_MAX_SEC} giây`);
      }
    }
    await fs.rename(tmp, dest);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
  return { url: `${MEDIA_PREFIX}${key}`, path: dest };
}

export async function deleteByUrls(urls: string[]): Promise<void> {
  for (const url of urls) {
    const key = keyFromUrl(url);
    if (!key) continue;
    let filePath: string;
    try {
      filePath = storagePath(key);
    } catch {
      continue;
    }
    await fs.rm(filePath, { force: true });
  }
}
