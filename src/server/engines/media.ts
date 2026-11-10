import { execFile } from "node:child_process";
import { EngineError } from "@/server/engines/types";

// Kiểm file kết quả sau khi tải (Muse từng trả mp4 hỏng khi tải nhiều video cùng lúc) và cắt khung cuối.

const PROBE_TIMEOUT_MS = 30_000;
const VIDEO_EXTS = [".mp4", ".webm", ".mov"];

function ffprobeBin(): string {
  return process.env.FFPROBE_BIN || "ffprobe";
}

function ffmpegBin(): string {
  return process.env.FFMPEG_BIN || "ffmpeg";
}

function run(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? (err as { code: number }).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export type ProbeResult = { hasVideo: boolean; width: number; height: number; duration: number };

export async function probeMedia(file: string): Promise<ProbeResult | null> {
  const { code, stdout } = await run(ffprobeBin(), [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_type,width,height:format=duration",
    "-of",
    "json",
    file,
  ]);
  if (code !== 0) return null;
  try {
    const data = JSON.parse(stdout) as {
      streams?: { codec_type?: string; width?: number; height?: number }[];
      format?: { duration?: string };
    };
    const video = (data.streams ?? []).find((s) => s.codec_type === "video");
    return {
      hasVideo: Boolean(video),
      width: Number(video?.width ?? 0),
      height: Number(video?.height ?? 0),
      duration: Number(data.format?.duration ?? 0) || 0,
    };
  } catch {
    return null;
  }
}

export function mediaKindOf(file: string, fallback: "image" | "video"): "image" | "video" {
  const lower = file.toLowerCase();
  return VIDEO_EXTS.some((e) => lower.endsWith(e)) ? "video" : fallback;
}

// File hỏng → EngineError BAD_MEDIA (retryable: tải / tạo lại). Trả kích thước / thời lượng thật.
// Thời lượng khác yêu cầu (Muse đôi khi trả 10 s khi xin 5 s) không phải lỗi.
export async function validateMedia(file: string, kind: "image" | "video"): Promise<ProbeResult> {
  const info = await probeMedia(file);
  if (!info?.hasVideo || info.width <= 0 || info.height <= 0) {
    throw new EngineError("BAD_MEDIA", `File ${kind} không đọc được`, true);
  }
  if (kind === "video") {
    if (!(info.duration > 0)) throw new EngineError("BAD_MEDIA", "Video không có thời lượng", true);
    // Giải mã giây cuối: file cụt đuôi (tải dở) sẽ lỗi ở đây.
    const tail = await run(ffmpegBin(), ["-v", "error", "-xerror", "-sseof", "-1", "-i", file, "-f", "null", "-"]);
    if (tail.code !== 0) throw new EngineError("BAD_MEDIA", `Video hỏng: ${tail.stderr.slice(-200)}`, true);
  } else {
    const dec = await run(ffmpegBin(), ["-v", "error", "-xerror", "-i", file, "-frames:v", "1", "-f", "null", "-"]);
    if (dec.code !== 0) throw new EngineError("BAD_MEDIA", `Ảnh hỏng: ${dec.stderr.slice(-200)}`, true);
  }
  return info;
}

// Khung cuối của video → ảnh PNG (khung đầu cho cảnh kế tiếp ở chế độ CHAIN).
export async function extractLastFrame(video: string, out: string): Promise<void> {
  const res = await run(ffmpegBin(), ["-v", "error", "-y", "-sseof", "-0.2", "-i", video, "-frames:v", "1", "-update", "1", out]);
  if (res.code !== 0) throw new EngineError("FRAME_FAILED", `Không cắt được khung cuối: ${res.stderr.slice(-200)}`, true);
  const info = await probeMedia(out);
  if (!info?.hasVideo) throw new EngineError("FRAME_FAILED", "Khung cuối rỗng", true);
}
