"use client";

import { useState } from "react";
import { Spinner } from "@/components/ui/Button";
import { buttonClass, Field, Message, readError } from "./AuthShell";

export function ForgotPasswordForm() {
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError("");
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(form.get("email")) }),
    });
    setPending(false);
    if (!res.ok) {
      setError(await readError(res));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return <Message kind="success">Nếu email đã đăng ký, chúng tôi đã gửi liên kết đặt lại mật khẩu (hiệu lực 1 giờ).</Message>;
  }

  return (
    <div className="space-y-4">
      {error && <Message kind="error">{error}</Message>}
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" name="email" type="email" autoComplete="email" required />
        <button type="submit" className={buttonClass} disabled={pending}>
          {pending && <Spinner />}
          {pending ? "Đang gửi" : "Gửi liên kết"}
        </button>
      </form>
    </div>
  );
}
