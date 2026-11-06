import type { NextAuthConfig } from "next-auth";

// Cấu hình dùng chung cho middleware (Edge): không import Prisma / bcrypt ở đây.
const PROTECTED_PREFIXES = ["/studio", "/library", "/credits", "/profile", "/admin"];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      return !isProtectedPath(request.nextUrl.pathname) || Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        token.role = user.role ?? "USER";
      }
      return token;
    },
    session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId;
        session.user.role = token.role ?? "USER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
