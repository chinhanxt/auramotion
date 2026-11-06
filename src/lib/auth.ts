import type { User } from "@prisma/client";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { authConfig } from "@/lib/auth.config";
import { AppError } from "@/lib/errors";
import { loadSessionUser, upsertGoogleUser, verifyCredentials } from "@/server/services/account";

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID);

const credentialsSchema = z.object({ email: z.string().min(1), password: z.string().min(1) });

const providers: Provider[] = [
  Credentials({
    credentials: { email: {}, password: {} },
    async authorize(raw) {
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) return null;
      const user = await verifyCredentials(parsed.data.email, parsed.data.password);
      return user ? { id: user.id, email: user.email, name: user.name, image: user.avatarUrl, role: user.role } : null;
    },
  }),
];

if (googleEnabled) {
  providers.push(
    Google({
      async profile(profile) {
        if (!profile.email_verified) throw new Error("Email Google chưa được xác minh");
        const user = await upsertGoogleUser({
          googleId: profile.sub,
          email: profile.email,
          name: profile.name,
          avatarUrl: profile.picture,
        });
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
          role: user.role,
          locked: user.status === "LOCKED",
        };
      },
    }),
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers,
  callbacks: {
    ...authConfig.callbacks,
    signIn({ user }) {
      return !user.locked;
    },
  },
});

export async function requireUser(): Promise<User> {
  const session = await auth();
  return loadSessionUser(session?.user?.id);
}

export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AppError("FORBIDDEN", "Bạn không có quyền truy cập");
  return user;
}
