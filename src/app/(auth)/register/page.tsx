import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Tạo tài khoản"
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-medium text-neutral-900 hover:underline">
            Đăng nhập
          </Link>
        </>
      }
    >
      <p className="text-center text-sm text-neutral-600">Tài khoản mới nhận gói Free kèm 20 Credit.</p>
      <RegisterForm />
    </AuthShell>
  );
}
