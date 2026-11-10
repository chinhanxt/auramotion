"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Spinner } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
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
    <div className="space-y-5">
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Mật khẩu" name="password" type="password" autoComplete="current-password" required />
        <div className="-mt-1 text-right text-[13px]">
          <Link href="/forgot-password" className="text-muted hover:text-fg">
            Quên mật khẩu?
          </Link>
        </div>
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Đang đăng nhập" : "Đăng nhập"}
        </button>
      </form>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-dim">
            <span className="h-px flex-1 bg-line2" />
            hoặc
            <span className="h-px flex-1 bg-line2" />
          </div>
          <button
            type="button"
            onClick={() => signIn("google", { redirectTo: callbackUrl })}
            className="press flex h-12 w-full items-center justify-center gap-2.5 rounded-m2 bg-white/[.05] text-[15px] font-medium shadow-[inset_0_0_0_1px_var(--color-line2)] hover:bg-white/[.09]"
          >
            <Icon name="google" size={18} />
            Tiếp tục với Google
          </button>
        </>
      )}
    </div>
  );
}
