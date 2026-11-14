import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
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
const scriptsInFlight = new Map<string, Promise<ScriptPreview>>();

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

export type ScriptSegment = { text: string; start: number; end: number };
export type ScriptPreview = { url: string; segments: ScriptSegment[] };
export const MAX_SCRIPT_LINES = 30;
const SCRIPT_TIMEOUT_MS = 480_000;

// Đọc cả kịch bản (mỗi dòng 1 câu) đúng như lúc ghép: file wav + mốc giờ từng câu để xem thử khớp bản xuất.
// Cùng giọng + cùng lời thì dùng lại file cũ.
export async function previewScript(voice: VoiceRef, lines: string[]): Promise<ScriptPreview> {
  if (!voice.preset && !voice.refPath) throw new EngineError("BAD_INPUT", "Cần chọn giọng hoặc audio mẫu");
  const clean = lines.map((l) => l.trim()).filter(Boolean);
  if (clean.length === 0 || clean.length > MAX_SCRIPT_LINES) throw new EngineError("BAD_INPUT", `Kịch bản 1–${MAX_SCRIPT_LINES} câu`);
  const id = voice.refPath ? { ref: voice.refPath } : { preset: voice.preset };
  const hash = createHash("sha1").update(JSON.stringify({ ...id, lines: clean })).digest("hex");
  const key = `previews/s-${hash}.wav`;
  const segKey = `previews/s-${hash}.json`;
  const read = async (): Promise<ScriptPreview | null> => {
    if (!(await exists(storagePath(key))) || !(await exists(storagePath(segKey)))) return null;
    return { url: `/media/${key}`, segments: JSON.parse(await readFile(storagePath(segKey), "utf8")) as ScriptSegment[] };
  };
  const cached = await read();
  if (cached) return cached;

  const flightKey = `script:${hash}`;
  const running = scriptsInFlight.get(flightKey);
  if (running) return running;
  const job = runCli({
    bin: vieneuBin(),
    args: (dir) => ["-f", path.join(dir, "s.txt"), "-o", path.join(dir, "s.wav"), "--segments", path.join(dir, "s.json"), ...(voice.refPath ? ["--ref", voice.refPath] : ["--voice", voice.preset!])],
    setup: (dir) => writeFile(path.join(dir, "s.txt"), clean.join("\n"), "utf8"),
    timeoutMs: SCRIPT_TIMEOUT_MS,
    collect: async (dir) => {
      const wav = path.join(dir, "s.wav");
      const seg = path.join(dir, "s.json");
      if (!(await exists(wav)) || !(await exists(seg))) throw new EngineError("NO_AUDIO", "vieneu-say không tạo file âm thanh");
      const segments = JSON.parse(await readFile(seg, "utf8")) as ScriptSegment[];
      await putFile(wav, key);
      await writeFile(storagePath(segKey), JSON.stringify(segments));
      return { url: `/media/${key}`, segments };
    },
  })
    .then(({ result }) => result)
    .finally(() => scriptsInFlight.delete(flightKey));
  scriptsInFlight.set(flightKey, job);
  return job;
}
