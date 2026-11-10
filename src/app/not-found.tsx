import { AuraField } from "@/components/landing/AuraField";
import { Logo } from "@/components/layout/Logo";
import { LinkButton } from "@/components/ui/Button";

export default function NotFound() {
  return (
    <main className="am relative flex flex-col items-center justify-center gap-6 overflow-hidden px-6 text-center">
      <AuraField intensity={0.6} />
      <div className="relative">
        <Logo />
      </div>
      <p className="t-display relative">404</p>
      <p className="relative text-muted">Trang này không tồn tại.</p>
      <LinkButton href="/" variant="primary" className="relative" iconRight="arrowRight">
        Về trang chủ
      </LinkButton>
    </main>
  );
}
