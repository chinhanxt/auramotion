import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCli } from "@/server/engines/cli";
import { EngineError } from "@/server/engines/types";

const TEXT_TIMEOUT_MS = 150_000;

export function codexBin(): string {
  return process.env.CODEX_BIN || "codex";
}

// `--ephemeral`: codex không lưu phiên (rollout) vào CODEX_HOME. Câu trả lời cuối ghi vào <dir>/last.txt.
export async function codexText(prompt: string, effort = "low"): Promise<string> {
  const { result } = await runCli({
    bin: codexBin(),
    args: (dir) => [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "-C",
      dir,
      "-s",
      "read-only",
      "-c",
      `model_reasoning_effort="${effort}"`,
      "-o",
      path.join(dir, "last.txt"),
      "--",
      prompt,
    ],
    timeoutMs: TEXT_TIMEOUT_MS,
    collect: (dir) =>
      readFile(path.join(dir, "last.txt"), "utf8").catch(() => {
        throw new EngineError("CODEX_FAILED", "codex không trả câu trả lời");
      }),
  });
  return result;
}
