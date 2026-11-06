import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Quên mật khẩu"
      footer={
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          Quay lại đăng nhập
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
