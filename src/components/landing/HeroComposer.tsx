"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";

const EXAMPLES = [
  "Chai nước hoa hổ phách xoay chậm trên đá cẩm thạch",
  "Tà áo dài bay trong gió, phố cổ lúc hoàng hôn",
  "Ly cà phê sữa đá, hơi lạnh đọng trên thành ly",
  "Chú mèo cam ngủ bên cửa sổ mưa",
];

type Target = "video" | "image" | "story";

// Ô prompt trên landing: placeholder tự gõ các ví dụ; gửi → mở studio với prompt (chưa đăng nhập thì qua trang login).
export function HeroComposer({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<Target>("video");
  const [shown, setShown] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (value || focused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(EXAMPLES[0]);
      return;
    }
    let ex = 0;
    let ch = 0;
    let del = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const s = EXAMPLES[ex];
      if (!del) {
        ch++;
        setShown(s.slice(0, ch));
        if (ch >= s.length) {
          del = true;
          t = setTimeout(tick, 2200);
          return;
        }
        t = setTimeout(tick, 38);
      } else {
        ch = Math.max(0, ch - 3);
        setShown(s.slice(0, ch));
        if (ch === 0) {
          del = false;
          ex = (ex + 1) % EXAMPLES.length;
          t = setTimeout(tick, 400);
          return;
        }
        t = setTimeout(tick, 18);
      }
    };
    t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, [value, focused]);

  function go() {
    const prompt = (value.trim() || shown.trim() || EXAMPLES[0]).slice(0, 2000);
    const dest = target === "story" ? `/studio/story?idea=${encodeURIComponent(prompt)}` : `/studio/${target}?prompt=${encodeURIComponent(prompt)}`;
    router.push(loggedIn ? dest : `/login?callbackUrl=${encodeURIComponent(dest)}`);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="hero-composer mx-auto w-full max-w-[760px] rounded-m4 glass-strong p-2.5 shadow-[0_0_0_1px_var(--color-line2),0_40px_120px_-30px_rgba(124,92,255,.55)]"
    >
      <div className="flex items-center gap-2">
        <span className="ml-1.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-m1 bg-white/[.05] text-accent sm:flex">
          <Icon name="sparkle" size={20} />
        </span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={focused ? "Mô tả điều bạn muốn tạo…" : shown}
          aria-label="Mô tả điều bạn muốn tạo"
          className="h-14 min-w-0 flex-1 bg-transparent px-2 text-[16px] sm:px-3 text-fg outline-none placeholder:text-fg/45 sm:text-[17px]"
        />
        <button
          type="submit"
          aria-label="Tạo"
          className="press flex h-12 shrink-0 items-center gap-2 rounded-m2 bg-accent px-4 text-[15px] font-bold text-accent-ink shadow-[0_10px_30px_-8px_rgba(212,255,58,.6)] hover:bg-[#e0ff6b] sm:px-5"
        >
          <span className="hidden sm:inline">Tạo</span>
          <Icon name="arrowRight" size={18} strokeWidth={2} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pt-1.5 pb-0.5">
        <Segmented
          size="sm"
          ariaLabel="Loại"
          options={[
            { value: "video" as const, label: "Video" },
            { value: "image" as const, label: "Ảnh" },
            { value: "story" as const, label: "Story" },
          ]}
          value={target}
          onChange={setTarget}
        />
        <span className={cx("hidden text-xs text-dim sm:inline", value && "opacity-0")}>Enter để bắt đầu</span>
      </div>
    </form>
  );
}
