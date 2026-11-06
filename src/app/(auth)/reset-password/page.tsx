import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell
      title="Đặt lại mật khẩu"
      footer={
        <Link href="/login" className="font-medium text-neutral-900 hover:underline">
          Quay lại đăng nhập
        </Link>
      }
    >
      <ResetPasswordForm token={(Array.isArray(token) ? token[0] : token) ?? ""} />
    </AuthShell>
  );
}
