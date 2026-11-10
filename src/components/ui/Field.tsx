import { forwardRef } from "react";
import { cx } from "./cx";

export const inputClass =
  "w-full rounded-m1 bg-white/[.04] px-3.5 text-[15px] text-fg shadow-[inset_0_0_0_1px_var(--color-line2)] outline-none transition-[box-shadow,background-color] duration-[160ms] placeholder:text-dim hover:bg-white/[.06] focus:bg-white/[.06] focus:shadow-[inset_0_0_0_1px_rgba(212,255,58,.7),0_0_0_4px_rgba(212,255,58,.12)] disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cx(inputClass, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(inputClass, "resize-y py-2.5 leading-relaxed", className)} {...props} />;
});

export function Field({ label, hint, className, ...props }: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx("block space-y-1.5", className)}>
      <span className="text-[13px] font-medium text-fg/75">{label}</span>
      <Input {...props} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function FormMessage({ kind, children }: { kind: "error" | "success"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={cx(
        "pop-in rounded-m1 px-3.5 py-2.5 text-sm",
        kind === "error" ? "bg-danger/10 text-[#ff9aa5] shadow-[inset_0_0_0_1px_rgba(255,92,108,.22)]" : "bg-ok/10 text-[#9af0b8] shadow-[inset_0_0_0_1px_rgba(74,222,128,.22)]",
      )}
    >
      {children}
    </p>
  );
}
