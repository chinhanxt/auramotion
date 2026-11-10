import Link from "next/link";
import { AuraField } from "@/components/landing/AuraField";
import { Logo } from "@/components/layout/Logo";
import { buttonClass as btn } from "@/components/ui/Button";
import { Field, FormMessage, inputClass } from "@/components/ui/Field";

export { inputClass, Field };
export const buttonClass = `${btn({ variant: "primary", size: "lg", block: true })} mt-2`;
export const Message = FormMessage;

export function AuthShell({ title, children, footer, subtitle }: { title: string; children: React.ReactNode; footer?: React.ReactNode; subtitle?: string }) {
  return (
    <main className="am grid lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden lg:block" aria-hidden="true">
        <AuraField />
        <div className="relative flex h-full min-h-dvh flex-col justify-between p-10 xl:p-14">
          <Logo />
          <div className="max-w-xl">
            <p className="t-display text-[clamp(3rem,1rem+4.5vw,6rem)]">
              Ý tưởng
              <br />
              thành <span className="aura-text">chuyển động.</span>
            </p>
          </div>
          <div className="flex gap-2">
            {["Ảnh", "Video", "Story", "Ghép"].map((t) => (
              <span key={t} className="glass rounded-full px-3.5 py-1.5 text-xs font-medium text-fg/80 hairline">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="relative flex min-h-dvh flex-col px-5 py-6 sm:px-10">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-50 lg:hidden" style={{ background: "radial-gradient(60% 80% at 50% 0%, rgba(124,92,255,.35), transparent 70%)" }} />
        <div className="relative lg:hidden">
          <Logo />
        </div>
        <div className="relative mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <div className="page-enter space-y-7">
            <div className="space-y-2">
              <h1 className="t-h1">{title}</h1>
              {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
            </div>
            {children}
            {footer && <div className="text-sm text-muted">{footer}</div>}
          </div>
        </div>
        <p className="relative text-center text-xs text-dim">
          <Link href="/pricing" className="hover:text-muted">
            Bảng giá
          </Link>
          <span className="mx-2">·</span>© AuraMotion
        </p>
      </section>
    </main>
  );
}

export function safeCallbackUrl(value: string | string[] | undefined, fallback = "/studio/image"): string {
  const url = Array.isArray(value) ? value[0] : value;
  if (!url) return fallback;
  // Middleware gửi callbackUrl dạng tuyệt đối; chỉ giữ path + query để không chuyển sang site khác.
  try {
    const { pathname, search } = new URL(url, "http://local");
    return pathname.startsWith("//") ? fallback : `${pathname}${search}`;
  } catch {
    return fallback;
  }
}

export async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Có lỗi xảy ra, vui lòng thử lại";
}

export const authLink = "font-semibold text-fg hover:text-accent";
