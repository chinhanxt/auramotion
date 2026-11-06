import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: [
    "/studio/:path*",
    "/library/:path*",
    "/credits/:path*",
    "/profile/:path*",
    "/admin/:path*",
  ],
};
