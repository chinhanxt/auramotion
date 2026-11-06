"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { buttonClass, Field, Message } from "./AuthShell";

export function LoginForm({ callbackUrl, googleEnabled, initialError }: { callbackUrl: string; googleEnabled: boolean; initialError?: string }) {
  const [error, setError] = useState(initialError ?? "");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    const res = await signIn("credentials", {
      email: String(form.get("email")),
      password: String(form.get("password")),
      redirect: false,
    });
    if (!res || res.error) {
      setPending(false);
      setError("Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa");
      return;
    }
    window.location.assign(callbackUrl);
  }

  return (
    <div className="space-y-4">
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Mật khẩu" name="password" type="password" autoComplete="current-password" required />
        <div className="text-right text-sm">
          <Link href="/forgot-password" className="text-neutral-600 hover:underline">
            Quên mật khẩu?
          </Link>
        </div>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            hoặc
            <span className="h-px flex-1 bg-neutral-200" />
          </div>
          <button
            type="button"
            onClick={() => signIn("google", { redirectTo: callbackUrl })}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            Đăng nhập bằng Google
          </button>
        </>
      )}
    </div>
  );
}
