import Link from "next/link";

export const inputClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900";
export const buttonClass =
  "w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50";

export function AuthShell({ title, children, footer }: { title: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <Link href="/" className="text-sm font-semibold tracking-wide text-neutral-500">
            AuraMotion
          </Link>
          <h1 className="text-xl font-semibold text-neutral-900">{title}</h1>
        </div>
        {children}
        {footer && <div className="text-center text-sm text-neutral-600">{footer}</div>}
      </div>
    </main>
  );
}

export function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

export function Message({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  const color = kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700";
  return <p className={`rounded-md px-3 py-2 text-sm ${color}`}>{children}</p>;
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
