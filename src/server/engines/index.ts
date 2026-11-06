import { agyImage } from "@/server/engines/agy";
import { codexImage } from "@/server/engines/codex";
import { HttpMuseClient } from "@/server/engines/muse";
import { EngineError, type FileEngine } from "@/server/engines/types";

export type FileProvider = "AGY" | "CODEX";

let muse: HttpMuseClient | undefined;

export function getMuse(): HttpMuseClient {
  muse ??= new HttpMuseClient();
  return muse;
}

// Engine tạo file trên máy (agy, codex) đăng ký tại đây.
const FILE_ENGINES: Partial<Record<FileProvider, FileEngine>> = { AGY: agyImage, CODEX: codexImage };

export function getFileEngine(provider: FileProvider): FileEngine {
  const engine = FILE_ENGINES[provider];
  if (!engine) throw new EngineError("NOT_IMPLEMENTED", `Engine ${provider} chưa được hỗ trợ`);
  return engine;
}

export function buildPrompt(prompt: string, preset?: { promptSuffix: string } | null): string {
  return preset?.promptSuffix ? `${prompt}, ${preset.promptSuffix}` : prompt;
}
