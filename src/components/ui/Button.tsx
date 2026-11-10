import Link from "next/link";
import { forwardRef } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export type ButtonVariant = "primary" | "ghost" | "glass" | "outline" | "danger" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-ink font-semibold hover:bg-[#e0ff6b] shadow-[0_0_0_1px_rgba(212,255,58,.4),0_10px_30px_-10px_rgba(212,255,58,.45)]",
  ghost: "text-fg/85 hover:text-fg hover:bg-white/[.06]",
  glass: "glass text-fg hairline hover:bg-white/[.09]",
  outline: "text-fg shadow-[inset_0_0_0_1px_var(--color-line2)] hover:bg-white/[.05] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,.22)]",
  danger: "bg-danger/12 text-danger shadow-[inset_0_0_0_1px_rgba(255,92,108,.25)] hover:bg-danger/20",
  subtle: "bg-s3 text-fg hover:bg-s4",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-m1 px-3 text-[13px]",
  md: "h-10 gap-2 rounded-m1 px-4 text-sm",
  lg: "h-12 gap-2 rounded-m2 px-6 text-[15px]",
};

export function buttonClass({ variant = "outline", size = "md", block = false }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean } = {}) {
  return cx(
    "press inline-flex select-none items-center justify-center whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-40",
    VARIANT[variant],
    SIZE[size],
    block && "w-full",
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={cx("h-4 w-4 animate-spin", className)} aria-hidden="true">
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="2" />
      <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  loading?: boolean;
  icon?: IconName;
  iconRight?: IconName;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = "md", block, loading, icon, iconRight, className, children, disabled, type = "button", ...rest },
  ref,
) {
  const iconSize = size === "sm" ? 16 : 18;
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={cx(buttonClass({ variant, size, block }), className)} {...rest}>
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={iconSize} />}
    </button>
  );
});

export function LinkButton({
  href,
  variant,
  size = "md",
  block,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Link>, "className"> & { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; icon?: IconName; iconRight?: IconName; className?: string }) {
  const iconSize = size === "sm" ? 16 : 18;
  return (
    <Link href={href} className={cx(buttonClass({ variant, size, block }), className)} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {iconRight && <Icon name={iconRight} size={iconSize} />}
    </Link>
  );
}

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  tip?: boolean;
};

const ICON_SIZE = { sm: "h-8 w-8 rounded-m1", md: "h-10 w-10 rounded-m1", lg: "h-12 w-12 rounded-m2" };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = "ghost", size = "md", loading, tip = true, className, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={tip ? label : undefined}
      disabled={disabled || loading}
      className={cx(
        "press inline-flex shrink-0 items-center justify-center disabled:pointer-events-none disabled:opacity-40",
        VARIANT[variant],
        ICON_SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : <Icon name={icon} size={size === "sm" ? 16 : 18} />}
    </button>
  );
});
