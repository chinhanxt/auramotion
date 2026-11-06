import type { User } from "@prisma/client";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { handle } from "@/lib/http";
import { updateProfile } from "@/server/services/account";

const bodySchema = z.object({ name: z.string().optional(), avatarUrl: z.string().nullable().optional() });

function toPublic(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    role: user.role,
    hasPassword: user.passwordHash !== null,
    googleLinked: user.googleId !== null,
    createdAt: user.createdAt,
  };
}

export function GET(): Promise<Response> {
  return handle(async () => toPublic(await requireUser()));
}

export function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    return toPublic(await updateProfile(user.id, bodySchema.parse(await req.json())));
  });
}
