import { randomUUID } from "node:crypto";
import { copyFile, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCli } from "@/server/engines/cli";
import { EngineError, type FileEngine, type MediaRequest } from "@/server/engines/types";

const TEXT_TIMEOUT_MS = 150_000;
const IMAGE_TIMEOUT_MS = 600_000;
const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp"];
const THREAD_ID = /^[\w-]+$/;

export function codexBin(): string {
  return process.env.CODEX_BIN || "codex";
}

// `--ephemeral`: codex không lưu phiên (rollout) vào CODEX_HOME. Câu trả lời cuối ghi vào <dir>/last.txt.
export async function codexText(
  prompt: string,
  effort = "low",
  opts: { model?: string; signal?: AbortSignal } = {},
): Promise<string> {
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
      ...(opts.model ? ["-m", opts.model] : []),
      "-o",
      path.join(dir, "last.txt"),
      "--",
      prompt,
    ],
    timeoutMs: TEXT_TIMEOUT_MS,
    signal: opts.signal,
    collect: (dir) =>
      readFile(path.join(dir, "last.txt"), "utf8").catch(() => {
        throw new EngineError("CODEX_FAILED", "codex không trả câu trả lời");
      }),
  });
  return result;
}

function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function imagePrompt(req: MediaRequest, refName?: string): string {
  const refs = refName
    ? `Attached images, in this order: Reference image 1 = attached image 1 (${refName}). Give them to the image tool in this same order.`
    : "Use no reference images.";
  return [
    "Use your built-in image generation tool exactly ONCE to create one image, then stop.",
    "Rules: do not run shell commands, do not create, edit or save any files, do not ask questions.",
    refs,
    `Aspect ratio: ${req.aspectRatio}.`,
    "",
    "Image prompt:",
    req.prompt,
  ].join("\n");
}

type CodexEvents = { threadId?: string; errors: string[]; said: string };

function parseEvents(stdout: string): CodexEvents {
  const events: CodexEvents = { errors: [], said: "" };
  for (const line of stdout.split("\n")) {
    let ev: { type?: string; thread_id?: unknown; message?: unknown; error?: { message?: unknown }; item?: { type?: string; text?: unknown } };
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev?.type === "thread.started" && typeof ev.thread_id === "string" && THREAD_ID.test(ev.thread_id)) {
      events.threadId = ev.thread_id;
    } else if (ev?.type === "error") {
      events.errors.push(String(ev.message ?? ""));
    } else if (ev?.type === "turn.failed") {
      events.errors.push(String(ev.error?.message ?? ""));
    } else if (ev?.type === "item.completed" && ev.item?.type === "agent_message") {
      events.said = String(ev.item.text ?? "");
    }
  }
  return events;
}

async function newestImage(dir: string): Promise<string | null> {
  const names = await readdir(dir).catch(() => [] as string[]);
  let best: { file: string; mtime: number } | null = null;
  for (const name of names) {
    if (!IMAGE_EXTS.includes(path.extname(name).toLowerCase())) continue;
    const file = path.join(dir, name);
    const { mtimeMs } = await stat(file);
    if (!best || mtimeMs > best.mtime) best = { file, mtime: mtimeMs };
  }
  return best?.file ?? null;
}

// Xóa ảnh và file rollout của đúng thread này; phiên khác trong CODEX_HOME giữ nguyên.
async function removeThread(home: string, threadId: string): Promise<void> {
  await rm(path.join(home, "generated_images", threadId), { recursive: true, force: true });
  const sessions = path.join(home, "sessions");
  const files = await readdir(sessions, { recursive: true }).catch(() => [] as string[]);
  const suffix = `-${threadId}.jsonl`;
  await Promise.all(
    files
      .filter((f) => path.basename(f).startsWith("rollout-") && path.basename(f).endsWith(suffix))
      .map((f) => rm(path.join(sessions, f), { force: true })),
  );
}

function classify(message: string): EngineError {
  const quote = message.trim().slice(-240);
  const said = quote ? ` Codex trả: «${quote}»` : " Codex không trả lời gì.";
  if (/rate.?limit|usage limit/i.test(message)) return new EngineError("QUOTA", "Tài khoản Codex hết lượt." + said, false);
  if (/not available|image generation/i.test(message)) {
    return new EngineError("NO_IMAGE_TOOL", "Tài khoản Codex không có công cụ tạo ảnh." + said);
  }
  return new EngineError("NO_IMAGE", "Codex không tạo được ảnh." + said);
}

// Ảnh codex nằm ở CODEX_HOME/generated_images/<thread_id>/, không ở thư mục chạy (sandbox). Prompt qua stdin vì
// `-i` nuốt các tham số phía sau. Sau khi chép ảnh ra os.tmpdir()/aura-out-*, luôn xóa ảnh và rollout của thread.
export const codexImage: FileEngine = {
  async generate(req, signal) {
    const home = codexHome();
    const refName = req.inputPath ? `ref-1${path.extname(req.inputPath).toLowerCase()}` : undefined;
    let stdout = "";
    let failure: unknown;
    try {
      await runCli({
        bin: codexBin(),
        args: (dir) => [
          "exec",
          "--skip-git-repo-check",
          "-C",
          dir,
          "-s",
          "workspace-write",
          "--json",
          ...(req.engineModel ? ["-m", req.engineModel] : []),
          ...(refName ? ["-i", path.join(dir, refName)] : []),
        ],
        stdin: imagePrompt(req, refName),
        env: { CODEX_HOME: home },
        timeoutMs: IMAGE_TIMEOUT_MS,
        setup: async (dir) => {
          if (req.inputPath && refName) await copyFile(req.inputPath, path.join(dir, refName));
        },
        onStdout: (chunk) => (stdout += chunk),
        signal,
      });
    } catch (err) {
      failure = err;
    }

    const events = parseEvents(stdout);
    let output: string | null = null;
    if (events.threadId) {
      try {
        const image = await newestImage(path.join(home, "generated_images", events.threadId));
        if (image) {
          output = path.join(os.tmpdir(), `aura-out-${randomUUID()}${path.extname(image).toLowerCase()}`);
          await copyFile(image, output);
        }
      } finally {
        await removeThread(home, events.threadId);
      }
    }

    if (failure instanceof EngineError && (failure.code === "TIMEOUT" || failure.code === "CANCELED")) {
      if (output) await rm(output, { force: true });
      throw failure;
    }
    if (output) return { files: [output] };
    const failMessage = failure instanceof Error ? failure.message : "";
    throw classify(events.errors.filter(Boolean).join(" ") || events.said || failMessage);
  },
};
