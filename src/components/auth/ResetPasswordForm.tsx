"use client";

import Link from "next/link";
import { useState } from "react";
import { buttonClass, Field, Message, readError } from "./AuthShell";

export function ResetPasswordForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    setPending(false);
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    setDone(true);
  }

  if (!token) return <Message kind="error">Liên kết đặt lại mật khẩu không hợp lệ.</Message>;

  if (done) {
    return (
      <div className="space-y-4">
        <Message kind="success">Đã đặt lại mật khẩu. Bạn có thể đăng nhập bằng mật khẩu mới.</Message>
        <Link href="/login" className={`${buttonClass} block text-center`}>
          Đăng nhập
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Mật khẩu mới (tối thiểu 8 ký tự)" name="password" type="password" minLength={8} autoComplete="new-password" required />
        <Field label="Nhập lại mật khẩu mới" name="confirm" type="password" minLength={8} autoComplete="new-password" required />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Đang lưu..." : "Đặt lại mật khẩu"}
        </button>
      </form>
    </div>
  );
}
