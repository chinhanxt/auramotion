"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Field, Message } from "@/components/auth/AuthShell";
import { api, postJson } from "@/lib/api-client";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const buttonClass =
  "rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";

export type ProfileUser = { name: string; email: string; avatarUrl: string | null; hasPassword: boolean; googleLinked: boolean };

type Feedback = { kind: "error" | "success"; text: string } | null;

function patchMe(data: { name?: string; avatarUrl?: string | null }) {
  return api<ProfileUser>("/api/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

function AvatarSection({ name, initialUrl }: { name: string; initialUrl: string | null }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState(initialUrl);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function save(next: string | null) {
    const user = await patchMe({ avatarUrl: next });
    setUrl(user.avatarUrl);
    router.refresh();
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setFeedback(null);
    if (!IMAGE_TYPES.includes(file.type)) return setFeedback({ kind: "error", text: "Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP" });
    if (file.size > MAX_BYTES) return setFeedback({ kind: "error", text: "Ảnh vượt quá 10 MB" });
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "image");
    setBusy(true);
    try {
      const { url: uploaded } = await api<{ url: string }>("/api/uploads", { method: "POST", body: form });
      await save(uploaded);
      setFeedback({ kind: "success", text: "Đã cập nhật ảnh đại diện" });
    } catch (err) {
      setFeedback({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    setFeedback(null);
    try {
      await save(null);
    } catch (err) {
      setFeedback({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        {url ? (
          <img src={url} alt="Ảnh đại diện" className="h-20 w-20 shrink-0 rounded-full border border-neutral-200 object-cover" />
        ) : (
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-2xl font-semibold text-neutral-600">
            {name.trim().charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <label
            className={`cursor-pointer rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 ${busy ? "pointer-events-none opacity-50" : ""}`}
          >
            {busy ? "Đang lưu..." : "Đổi ảnh"}
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              disabled={busy}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </label>
          {url && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
            >
              Xóa ảnh
            </button>
          )}
        </div>
      </div>
      {feedback && <Message kind={feedback.kind}>{feedback.text}</Message>}
    </div>
  );
}

function NameForm({ initialName, email }: { initialName: string; email: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const user = await patchMe({ name });
      setName(user.name);
      setFeedback({ kind: "success", text: "Đã lưu thông tin" });
      router.refresh();
    } catch (err) {
      setFeedback({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" value={email} disabled readOnly />
      <Field label="Tên hiển thị" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
      {feedback && <Message kind={feedback.kind}>{feedback.text}</Message>}
      <button type="submit" disabled={busy || !name.trim()} className={buttonClass}>
        {busy ? "Đang lưu..." : "Lưu"}
      </button>
    </form>
  );
}

function PasswordForm({ initialHasPassword }: { initialHasPassword: boolean }) {
  const [hasPassword, setHasPassword] = useState(initialHasPassword);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (newPassword.length < 8) return setFeedback({ kind: "error", text: "Mật khẩu tối thiểu 8 ký tự" });
    if (newPassword !== confirm) return setFeedback({ kind: "error", text: "Mật khẩu nhập lại không khớp" });
    setBusy(true);
    try {
      await postJson("/api/me/password", { oldPassword, newPassword });
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      setHasPassword(true);
      setFeedback({ kind: "success", text: hasPassword ? "Đã đổi mật khẩu" : "Đã đặt mật khẩu" });
    } catch (err) {
      setFeedback({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!hasPassword && (
        <p className="text-sm text-neutral-600">Tài khoản đăng nhập bằng Google, chưa có mật khẩu. Đặt mật khẩu để đăng nhập bằng email.</p>
      )}
      {hasPassword && (
        <Field
          label="Mật khẩu hiện tại"
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          required
        />
      )}
      <Field
        label="Mật khẩu mới"
        type="password"
        autoComplete="new-password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        minLength={8}
        required
      />
      <Field
        label="Nhập lại mật khẩu mới"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        minLength={8}
        required
      />
      {feedback && <Message kind={feedback.kind}>{feedback.text}</Message>}
      <button type="submit" disabled={busy} className={buttonClass}>
        {busy ? "Đang lưu..." : hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu"}
      </button>
    </form>
  );
}

export function ProfileForm({ user }: { user: ProfileUser }) {
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 sm:p-6">
        <h2 className="text-base font-semibold">Thông tin cá nhân</h2>
        <AvatarSection name={user.name} initialUrl={user.avatarUrl} />
        <NameForm initialName={user.name} email={user.email} />
        {user.googleLinked && <p className="text-xs text-neutral-500">Đã liên kết tài khoản Google.</p>}
      </section>
      <section className="space-y-4 rounded-lg border border-neutral-200 bg-white p-4 sm:p-6">
        <h2 className="text-base font-semibold">{user.hasPassword ? "Đổi mật khẩu" : "Đặt mật khẩu"}</h2>
        <PasswordForm initialHasPassword={user.hasPassword} />
      </section>
    </div>
  );
}
