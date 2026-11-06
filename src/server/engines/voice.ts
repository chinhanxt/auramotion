import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { putFile, storagePath } from "@/lib/storage";
import { runCli } from "@/server/engines/cli";
import { EngineError } from "@/server/engines/types";

export type Voice = { id: string; name: string; gender: string; region: string; style: string };
export type VoiceRef = { preset?: string; refPath?: string };

export const SAMPLE_TEXT = "Xin chào, đây là giọng đọc mẫu cho video của bạn.";
export const MAX_PREVIEW_TEXT = 120;

const LIST_TTL_MS = 60 * 60 * 1000;
const LIST_TIMEOUT_MS = 120_000;
const PREVIEW_TIMEOUT_MS = 180_000;

export function vieneuBin(): string {
  return process.env.VIENEU_BIN || "vieneu-say";
}

// Dòng dạng "⭐ Trúc Ly — Nữ · Bắc · Phong cách tự nhiên" (⭐ = giọng nổi bật, có thể không có).
function parseVoiceLine(line: string): Voice | null {
  const [head, rest] = line.replace(/^\s*⭐\s*/, "").split(" — ");
  const name = head?.trim();
  if (!name || !rest) return null;
  const [gender = "", region = "", style = ""] = rest.split("·").map((s) => s.trim());
  return { id: name, name, gender, region, style };
}

const globalForVoice = globalThis as unknown as {
  voiceList?: { at: number; voices: Voice[] };
  voiceListLoading?: Promise<Voice[]>;
  voicePreviews?: Map<string, Promise<string>>;
};
const previewsInFlight = (globalForVoice.voicePreviews ??= new Map());

export async function listVoices(): Promise<Voice[]> {
  const cached = globalForVoice.voiceList;
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.voices;

  globalForVoice.voiceListLoading ??= runCli({ bin: vieneuBin(), args: ["--list"], timeoutMs: LIST_TIMEOUT_MS })
    .then(({ stdout }) => {
      const voices = stdout.split("\n").map(parseVoiceLine).filter((v): v is Voice => v !== null);
      if (voices.length === 0) throw new EngineError("BAD_OUTPUT", "vieneu-say --list không trả giọng nào");
      globalForVoice.voiceList = { at: Date.now(), voices };
      return voices;
    })
    .finally(() => {
      globalForVoice.voiceListLoading = undefined;
    });
  return globalForVoice.voiceListLoading;
}

function previewKey(voice: VoiceRef, text: string): string {
  const id = voice.refPath ? { ref: voice.refPath } : { preset: voice.preset };
  return `previews/${createHash("sha1").update(JSON.stringify({ ...id, text })).digest("hex")}.wav`;
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

// Đọc câu mẫu bằng giọng có sẵn hoặc giọng clone, lưu `previews/{sha1}.wav`; cùng giọng + câu thì dùng lại file cũ.
export async function previewVoice(voice: VoiceRef, text: string = SAMPLE_TEXT): Promise<string> {
  if (!voice.preset && !voice.refPath) throw new EngineError("BAD_INPUT", "Cần chọn giọng hoặc audio mẫu");
  if (text.length === 0 || text.length > MAX_PREVIEW_TEXT) {
    throw new EngineError("BAD_INPUT", `Câu nghe thử dài 1–${MAX_PREVIEW_TEXT} ký tự`);
  }
  const key = previewKey(voice, text);
  if (await exists(storagePath(key))) return `/media/${key}`;

  const running = previewsInFlight.get(key);
  if (running) return running;

  const job = runCli({
    bin: vieneuBin(),
    // "--" để câu bắt đầu bằng "-" không bị hiểu là tùy chọn.
    args: (dir) => [
      "-o",
      path.join(dir, "p.wav"),
      ...(voice.refPath ? ["--ref", voice.refPath] : ["--voice", voice.preset!]),
      "--",
      text,
    ],
    timeoutMs: PREVIEW_TIMEOUT_MS,
    collect: async (dir) => {
      const out = path.join(dir, "p.wav");
      if (!(await exists(out))) throw new EngineError("NO_AUDIO", "vieneu-say không tạo file âm thanh");
      return putFile(out, key);
    },
  })
    .then(({ result }) => result)
    .finally(() => previewsInFlight.delete(key));
  previewsInFlight.set(key, job);
  return job;
}
