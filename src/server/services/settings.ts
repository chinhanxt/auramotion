import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export async function getSetting<T>(key: string): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } });
  if (!row) throw new AppError("NOT_FOUND", `Chưa có cấu hình "${key}"`);
  return row.value as T;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const json = value as Prisma.InputJsonValue;
  await db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
}
