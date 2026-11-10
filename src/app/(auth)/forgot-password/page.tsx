import Link from "next/link";
import { AuthShell, authLink } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Quên mật khẩu"
      subtitle="Nhập email, chúng tôi gửi liên kết đặt lại."
      footer={
        <Link href="/login" className={authLink}>
          Quay lại đăng nhập
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
