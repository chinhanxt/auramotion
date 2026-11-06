import type { User } from "@prisma/client";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";

// Gọi ở layout và từng trang admin (trang có thể render riêng khi điều hướng phía client).
export async function adminPage(): Promise<User> {
  try {
    return await requireAdmin();
  } catch (err) {
    if (err instanceof AppError && err.code === "FORBIDDEN") notFound();
    redirect("/login");
  }
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v?.trim() || undefined;
}
