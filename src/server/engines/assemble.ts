import { writeFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "@/server/engines/cli";
import { EngineError } from "@/server/engines/types";
import type { AssembleParams } from "@/server/services/pricing";

// VieNeu chạy CPU: ghép 20 câu có thể mất hơn 10 phút. Bằng thời hạn hàng đợi `post`.
const ASSEMBLE_TIMEOUT_MS = 1_200_000;
const DEFAULT_IMAGE_SEC = 3;
const CLIP_AUDIO_DB = -6;
const MUSIC_DB = -14;

export type ClipFile = { path: string; kind: "image" | "video" };

export type AssembleSpec = {
  aspect: AssembleParams["aspect"];
  clips: ({ type: "image"; src: string; duration: number } | { type: "video"; src: string; in: number; out?: number })[];
  clip_audio_db: number | null;
  voice?: { lines: string[]; voice?: string } | { lines: string[]; ref: string };
  music?: { src: string; volume_db: number };
  subtitles: boolean;
  out: string;
  tmp_dir?: string;
};

// Map tham số job sang spec của tools/post/assemble.py (xem docs/post-production.md).
export function buildAssembleSpec(
  params: AssembleParams,
  clipFiles: ClipFile[],
  musicPath: string | null,
  refPath: string | null,
  out: string,
): AssembleSpec {
  const clips = params.clips.map((clip, i): AssembleSpec["clips"][number] => {
    const file = clipFiles[i];
    if (file.kind === "image") return { type: "image", src: file.path, duration: clip.duration ?? DEFAULT_IMAGE_SEC };
    return { type: "video", src: file.path, in: clip.in ?? 0, ...(clip.out !== undefined ? { out: clip.out } : {}) };
  });
  const { lines } = params;
  const voice = !lines.length
    ? undefined
    : refPath
      ? { lines, ref: refPath }
      : { lines, ...(params.voice?.preset ? { voice: params.voice.preset } : {}) };
  return {
    aspect: params.aspect,
    clips,
    clip_audio_db: params.keepClipAudio ? CLIP_AUDIO_DB : null,
    ...(voice ? { voice } : {}),
    ...(musicPath ? { music: { src: musicPath, volume_db: MUSIC_DB } } : {}),
    subtitles: params.subtitles,
    out,
  };
}

// Chạy assemble.py trong thư mục tạm của runCli; file làm việc của script cũng nằm trong đó (`tmp_dir`)
// để quá giờ bị kill vẫn được dọn. Script tự gọi vieneu-say qua biến môi trường VIENEU_BIN.
export async function runAssemble(spec: object): Promise<{ output: string; duration: number }> {
  const script = path.resolve("tools/post/assemble.py");
  let stdout: string;
  try {
    ({ stdout } = await runCli({
      bin: process.env.ASSEMBLE_PY || "python3",
      args: (dir) => [script, path.join(dir, "spec.json")],
      setup: (dir) => writeFile(path.join(dir, "spec.json"), JSON.stringify({ ...spec, tmp_dir: dir }), "utf8"),
      timeoutMs: ASSEMBLE_TIMEOUT_MS,
    }));
  } catch (err) {
    if (err instanceof EngineError && err.code === "CLI_FAILED") throw new EngineError("ASSEMBLE_FAILED", err.message);
    throw err;
  }
  const last = stdout.trim().split("\n").at(-1) ?? "";
  let result: { output?: string; duration?: number; error?: string };
  try {
    result = JSON.parse(last);
  } catch {
    throw new EngineError("ASSEMBLE_FAILED", `assemble.py trả kết quả lạ: ${last.slice(-300)}`);
  }
  if (result.error || !result.output) throw new EngineError("ASSEMBLE_FAILED", result.error ?? "assemble.py không trả file");
  return { output: result.output, duration: Number(result.duration ?? 0) };
}
