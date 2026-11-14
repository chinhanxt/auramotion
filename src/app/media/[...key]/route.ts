import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { storagePath } from "@/lib/storage";
import { ensureLiteVideo, ensureThumb, liteIfReady, snapWidth } from "@/lib/thumb";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

// Chỉ hỗ trợ một khoảng: "bytes=a-b", "bytes=a-", "bytes=-n".
// undefined = sai cú pháp / nhiều khoảng → bỏ qua Range, trả cả file; null = không thỏa được → 416.
function parseRange(header: string, size: number): { start: number; end: number } | null | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return undefined;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (m[2] !== "" && Number(m[2]) < start) return undefined;
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size) return null;
  return { start, end };
}

export async function GET(req: Request, { params }: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const { key } = await params;
  let filePath: string;
  try {
    filePath = storagePath(key.join("/"));
  } catch {
    return notFound();
  }
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) return notFound();

  // Ảnh thu nhỏ / khung hình xem trước: sinh 1 lần rồi cache vĩnh viễn (URL gốc bất biến).
  const url = new URL(req.url);
  const ext = path.extname(filePath).toLowerCase();
  const isVideo = ext === ".mp4" || ext === ".webm";
  const w = snapWidth(url.searchParams.get("w") ?? url.searchParams.get("poster"));
  if (w && ((!isVideo && url.searchParams.has("w") && CONTENT_TYPES[ext]?.startsWith("image/")) || (isVideo && url.searchParams.has("poster")))) {
    try {
      const { file, etag } = await ensureThumb(filePath, isVideo ? "poster" : "image", w);
      const h = { "Cache-Control": "public, max-age=31536000, immutable", ETag: etag, "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" };
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
      const st = await fs.stat(file);
      return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers: { ...h, "Content-Length": String(st.size) } });
    } catch (err) {
      console.warn(`[media] không tạo được ảnh thu nhỏ ${key.join("/")}: ${(err as Error).message.slice(0, 160)}`);
    }
  }

  // Video xem trước: bản nhẹ 360p (cache vĩnh viễn, vẫn hỗ trợ Range). Lỗi → phục vụ file gốc.
  let servePath = filePath;
  let serveStat = stat;
  let immutable: string | null = null;
  if (isVideo && url.searchParams.get("lite") === "1") {
    try {
      // Chưa có bản nhẹ: không bắt người xem chờ ffmpeg, phát ngay file gốc (Range) và sinh bản nhẹ nền cho lần sau.
      const lite = await liteIfReady(filePath);
      if (lite) {
        servePath = lite.file;
        serveStat = await fs.stat(lite.file);
        immutable = lite.etag;
      } else void ensureLiteVideo(filePath).catch(() => null);
    } catch (err) {
      console.warn(`[media] không tạo được bản nhẹ ${key.join("/")}: ${(err as Error).message.slice(0, 160)}`);
    }
  }

  const size = serveStat.size;
  const headers = new Headers({
    "Content-Type": CONTENT_TYPES[path.extname(servePath).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=604800",
    "X-Content-Type-Options": "nosniff",
  });

  const rangeHeader = req.headers.get("range");
  const range = rangeHeader ? parseRange(rangeHeader, size) : undefined;
  if (range !== undefined) {
    if (range === null) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.end - range.start + 1));
    const stream = createReadStream(servePath, range);
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(servePath)) as ReadableStream, { status: 200, headers });
}
