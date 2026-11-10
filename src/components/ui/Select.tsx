import { forwardRef } from "react";
import { cx } from "./cx";
import { inputClass } from "./Field";
import { Icon } from "./Icon";

// Ô chọn native (giữ bàn phím / mobile picker), cùng kiểu với Input.
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { inputSize?: "sm" | "md" }>(function Select(
  { className, inputSize = "md", children, ...props },
  ref,
) {
  return (
    <span className={cx("relative block", className)}>
      <select
        ref={ref}
        className={cx(inputClass, "cursor-pointer appearance-none pr-9", inputSize === "sm" ? "h-9 text-[13px]" : "h-11")}
        {...props}
      >
        {children}
      </select>
      <Icon name="chevronDown" size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
    </span>
  );
});
