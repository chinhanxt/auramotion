import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "@/server/engines/cli";
import { EngineError } from "@/server/engines/types";

const STATE_FILES = ["antigravity-oauth-token", "installation_id", "settings.json"];
const TEXT_TIMEOUT_MS = 150_000;

const WRITER_AGENT = `---
name: writer
description: Writes text from the message only and returns JSON, without tools.
tools: []
inheritCustomizations: false
---
Write exactly what the message asks for, using text only. Do not use tools, do not read files.
`;

export function agyBin(): string {
  return process.env.AGY_BIN || "agy";
}

// Tham số trạng thái riêng cho 1 lệnh agy: hội thoại, brain… nằm trong <dir>/.agy-state, xóa cùng thư mục tạm.
export function agyStateArgs(dir: string): string[] {
  return ["--gemini_dir", path.join(dir, ".agy-state"), "--app_data_dir", "antigravity-cli"];
}

// Chép token đăng nhập agy vào trạng thái tạm (mode 600) và ghi agent vào <dir>/.agents/agents/<name>.md.
export async function setupAgyWorkspace(dir: string, agents: Record<string, string>): Promise<void> {
  const home = process.env.AGY_HOME || path.join(os.homedir(), ".gemini", "antigravity-cli");
  const app = path.join(dir, ".agy-state", "antigravity-cli");
  await mkdir(app, { recursive: true, mode: 0o700 });
  for (const name of STATE_FILES) {
    const target = path.join(app, name);
    try {
      await copyFile(path.join(home, name), target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    await chmod(target, 0o600);
  }
  const agentDir = path.join(dir, ".agents", "agents");
  await mkdir(agentDir, { recursive: true });
  for (const [name, body] of Object.entries(agents)) {
    await writeFile(path.join(agentDir, `${name}.md`), body);
  }
}

// stdout của `agy --output-format json`: lấy JSON giữa `{` đầu và `}` cuối (agy có thể in dòng khác trước).
export function parseAgyOutput(stdout: string): string {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start === -1 || end < start) throw new EngineError("AGY_FAILED", `agy không trả JSON: ${stdout.slice(-300)}`);
  let data: { status?: string; response?: unknown };
  try {
    data = JSON.parse(stdout.slice(start, end + 1));
  } catch {
    throw new EngineError("AGY_FAILED", `agy trả JSON hỏng: ${stdout.slice(-300)}`);
  }
  if (data.status !== "SUCCESS") throw new EngineError("AGY_FAILED", `agy lỗi: ${JSON.stringify(data).slice(0, 300)}`);
  return typeof data.response === "string" ? data.response : "";
}

export async function agyText(prompt: string, model: string): Promise<string> {
  const { stdout } = await runCli({
    bin: agyBin(),
    args: (dir) => [
      ...agyStateArgs(dir),
      "-p",
      prompt,
      "--model",
      model,
      "--agent",
      "writer",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
      "--print-timeout",
      "120s",
    ],
    timeoutMs: TEXT_TIMEOUT_MS,
    setup: (dir) => setupAgyWorkspace(dir, { writer: WRITER_AGENT }),
  });
  return parseAgyOutput(stdout);
}
