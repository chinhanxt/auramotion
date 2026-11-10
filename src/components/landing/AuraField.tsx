import { cx } from "@/components/ui/cx";

// Trường màu aura chỉ bằng CSS: các khối màu mờ trôi / xoay rất chậm (chỉ transform), phủ hạt nhiễu + viền tối.
export function AuraField({ className, intensity = 1 }: { className?: string; intensity?: number }) {
  return (
    <div className={cx("aura-field pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true" style={{ opacity: intensity }}>
      <div className="aura-blob aura-blob-a" />
      <div className="aura-blob aura-blob-b" />
      <div className="aura-blob aura-blob-c" />
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_40%,#070708_92%)]" />
      <div className="grain absolute inset-0" />
    </div>
  );
}
