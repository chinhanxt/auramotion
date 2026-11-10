import { redis } from "@/lib/redis";

// Cờ "Muse không tạo được video" (tài khoản bị chặn theo vùng). Có cờ thì từ chối job video MUSE trước khi giữ Credit.
const TTL_SEC = 6 * 60 * 60;

function key(): string {
  return process.env.NODE_ENV === "test" ? "am:test:muse:videoBlocked" : "am:muse:videoBlocked";
}

export type VideoBlock = { at: string; message: string };

export async function setVideoBlocked(message: string): Promise<void> {
  const value: VideoBlock = { at: new Date().toISOString(), message: message.slice(0, 500) };
  await redis.set(key(), JSON.stringify(value), "EX", TTL_SEC).catch(() => null);
}

export async function getVideoBlocked(): Promise<VideoBlock | null> {
  const raw = await redis.get(key()).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VideoBlock;
  } catch {
    return null;
  }
}

export async function clearVideoBlocked(): Promise<void> {
  await redis.del(key()).catch(() => 0);
}
