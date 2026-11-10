import { LinkButton } from "@/components/ui/Button";

export default function UserNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="t-display aura-text">404</p>
      <div className="space-y-1.5">
        <h1 className="t-h2">Không tìm thấy</h1>
        <p className="text-sm text-muted">Có thể đã bị xóa hoặc không thuộc tài khoản của bạn.</p>
      </div>
      <LinkButton href="/library" variant="primary" iconRight="arrowRight">
        Về Thư viện
      </LinkButton>
    </div>
  );
}
