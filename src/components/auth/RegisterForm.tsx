"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { buttonClass, Field, Message, readError } from "./AuthShell";

export function RegisterForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) {
      setError("Mật khẩu nhập lại không khớp");
      return;
    }
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(form.get("name")), email, password }),
    });
    if (!res.ok) {
      setPending(false);
      setError(await readError(res));
      return;
    }
    const login = await signIn("credentials", { email, password, redirect: false });
    window.location.assign(login && !login.error ? "/studio/image" : "/login");
  }

  return (
    <div className="space-y-4">
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Tên hiển thị" name="name" autoComplete="name" required />
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <Field label="Mật khẩu (tối thiểu 8 ký tự)" name="password" type="password" minLength={8} autoComplete="new-password" required />
        <Field label="Nhập lại mật khẩu" name="confirm" type="password" minLength={8} autoComplete="new-password" required />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending ? "Đang tạo tài khoản..." : "Đăng ký"}
        </button>
      </form>
    </div>
  );
}
