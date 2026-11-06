import Link from "next/link";
import { AuthShell, safeCallbackUrl } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { googleEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  AccessDenied: "Tài khoản đã bị khóa hoặc không được phép đăng nhập",
  OAuthCallbackError: "Đăng nhập Google không thành công",
  Configuration: "Đăng nhập không thành công, vui lòng thử lại",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <AuthShell
      title="Đăng nhập"
      footer={
        <>
          Chưa có tài khoản?{" "}
          <Link href="/register" className="font-medium text-neutral-900 hover:underline">
            Đăng ký
          </Link>
        </>
      }
    >
      <LoginForm
        callbackUrl={safeCallbackUrl(params.callbackUrl)}
        googleEnabled={googleEnabled}
        initialError={errorCode ? (ERRORS[errorCode] ?? "Đăng nhập không thành công") : undefined}
      />
    </AuthShell>
  );
}
