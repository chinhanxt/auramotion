import Link from "next/link";
import { AuthShell, authLink } from "@/components/auth/AuthShell";
import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <AuthShell
      title="Tạo tài khoản"
      subtitle="Nhận ngay gói Free kèm 20 Credit."
      footer={
        <>
          Đã có tài khoản?{" "}
          <Link href="/login" className={authLink}>
            Đăng nhập
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
