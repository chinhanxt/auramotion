import Link from "next/link";
import { AuthShell, authLink } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Đặt lại mật khẩu"
      footer={
        <Link href="/login" className={authLink}>
          Quay lại đăng nhập
        </Link>
      }
    >
      <ResetPasswordForm token={(Array.isArray(token) ? token[0] : token) ?? ""} />
    </AuthShell>
  );
}
