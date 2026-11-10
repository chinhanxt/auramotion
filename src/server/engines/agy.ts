import { randomUUID } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cliLock, runCli } from "@/server/engines/cli";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";

const STATE_FILES = ["antigravity-oauth-token", "installation_id", "settings.json"];
const TEXT_TIMEOUT_MS = 150_000;
const IMAGE_TIMEOUT_MS = 510_000;
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
// Trong brain/: ảnh người dùng tải lên và file hệ thống của agy, không phải kết quả.
const SKIP_PARTS = new Set([".user_uploaded", ".system_generated"]);
const REFUSAL_TEXT = /can't|cannot|không thể/i;

const WRITER_AGENT = `---
name: writer
description: Writes text from the message only and returns JSON, without tools.
tools: []
inheritCustomizations: false
---
Write exactly what the message asks for, using text only. Do not use tools, do not read files.
`;

const IMAGEGEN_AGENT = `---
name: imagegen
description: Draws exactly one image with the generate_image tool and stops.
tools:
  - generate_image
excludeDefaultComponents: true
mainAgent: true
---
Call generate_image exactly once with the user's image prompt and the listed reference images (absolute paths, in the given order). Then reply with the single word done. Never call any other tool, never retry, never review the result.
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
  let data: { status?: string; response?: unknown } | null = null;
  try {
    data = start !== -1 && end > start ? JSON.parse(stdout.slice(start, end + 1)) : null;
  } catch {
    data = null;
  }
  // Không có vỏ {status, response}: agy (khi chạy song song) có lúc in thẳng câu trả lời — trả nguyên văn để bên gọi tự đọc.
  if (!data || (data.status === undefined && data.response === undefined)) {
    const raw = stdout.trim();
    if (raw) return raw;
    throw new EngineError("AGY_FAILED", "agy không trả gì");
  }
  if (data.status !== "SUCCESS") throw new EngineError("AGY_FAILED", `agy lỗi: ${JSON.stringify(data).slice(0, 300)}`);
  return typeof data.response === "string" ? data.response : "";
}

export async function agyText(prompt: string, model: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await runCli({
    bin: agyBin(),
    lock: cliLock("agy"),
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
    signal,
    setup: (dir) => setupAgyWorkspace(dir, { writer: WRITER_AGENT }),
  });
  return parseAgyOutput(stdout);
}

// Ảnh mới nhất (mtime ≥ startedMs) trong thư mục tạm, gồm brain/ của agy trong .agy-state; bỏ ảnh tham chiếu ref-*.
async function findImage(dir: string, startedMs: number): Promise<string | null> {
  let best: { file: string; mtime: number } | null = null;
  for (const rel of await readdir(dir, { recursive: true })) {
    const parts = rel.split(path.sep);
    if (!IMAGE_EXT.has(path.extname(rel).toLowerCase())) continue;
    if ((parts.length === 1 && rel.startsWith("ref-")) || parts.some((p) => SKIP_PARTS.has(p))) continue;
    const file = path.join(dir, rel);
    const info = await stat(file);
    if (!info.isFile() || info.mtimeMs < startedMs) continue;
    if (!best || info.mtimeMs > best.mtime) best = { file, mtime: info.mtimeMs };
  }
  return best?.file ?? null;
}

function imagePrompt(req: MediaRequest, refPath: string | null): string {
  const refs = refPath ? `Reference image 1 = ${refPath}` : "Use no reference images.";
  return (
    "Generate exactly one image with the generate_image tool, then stop. Do not run commands, read files or retry.\n" +
    `${refs}\nAspect ratio: ${req.aspectRatio}.\n\nIMAGE PROMPT:\n${req.prompt}`
  );
}

// Tạo 1 ảnh bằng agent `imagegen` (chỉ có tool generate_image). Ảnh chép ra os.tmpdir()/aura-out-* trước khi
// runCli xóa thư mục tạm; finishJob xóa file đó sau khi lưu vào storage.
export const agyImage: FileEngine = {
  async generate(req, signal) {
    // Làm tròn xuống giây: hệ file có mtime thô vẫn không bỏ sót ảnh vừa tạo.
    const startedMs = Math.floor(Date.now() / 1000) * 1000;
    const refName = req.inputPath ? `ref-1${path.extname(req.inputPath).toLowerCase() || ".png"}` : null;
    const { result } = await runCli({
      bin: agyBin(),
      lock: cliLock("agy"),
      args: (dir) => [
        ...agyStateArgs(dir),
        "-p",
        imagePrompt(req, refName && path.join(dir, refName)),
        "--model",
        req.engineModel,
        "--agent",
        "imagegen",
        "--dangerously-skip-permissions",
        "--output-format",
        "json",
        "--print-timeout",
        "480s",
      ],
      timeoutMs: IMAGE_TIMEOUT_MS,
      signal,
      setup: async (dir) => {
        await setupAgyWorkspace(dir, { imagegen: IMAGEGEN_AGENT });
        if (req.inputPath && refName) await copyFile(req.inputPath, path.join(dir, refName));
      },
      collect: async (dir, stdout) => {
        const image = await findImage(dir, startedMs);
        if (image) {
          const out = path.join(os.tmpdir(), `aura-out-${randomUUID()}${path.extname(image).toLowerCase()}`);
          await copyFile(image, out);
          return out;
        }
        const answer = parseAgyOutput(stdout).trim().slice(0, 300);
        const said = answer ? ` agy trả: «${answer}»` : " agy không trả lời gì.";
        if (REFUSAL_TEXT.test(answer)) throw new EngineError("REFUSED", `Công cụ ảnh từ chối tạo ảnh này.${said}`);
        throw new EngineError("NO_IMAGE", `agy chạy xong nhưng không có ảnh.${said}`, true);
      },
    });
    return { files: [result] };
  },
};
