"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./cx";

// Một IntersectionObserver dùng chung cho mọi media: tiết kiệm khi lưới có hàng trăm ô.
type Cb = (visible: boolean) => void;
let io: IntersectionObserver | null = null;
const cbs = new WeakMap<Element, Cb>();
function observe(el: Element, cb: Cb) {
  if (typeof IntersectionObserver === "undefined") {
    cb(true);
    return () => {};
  }
  io ??= new IntersectionObserver(
    (entries) => entries.forEach((e) => cbs.get(e.target)?.(e.isIntersecting && e.intersectionRatio > 0.35)),
    { threshold: [0, 0.35, 0.6] },
  );
  cbs.set(el, cb);
  io.observe(el);
  return () => {
    io?.unobserve(el);
    cbs.delete(el);
  };
}

export function useInView<T extends Element>(ref: React.RefObject<T | null>) {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    return observe(ref.current, setV);
  }, [ref]);
  return v;
}

// Ảnh hiện dần (blur → nét) khi tải xong.
export function FadeImage({ src, alt, className, imgClassName, style }: { src: string; alt: string; className?: string; imgClassName?: string; style?: React.CSSProperties }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <span className={cx("relative block overflow-hidden", className)} style={style}>
      {!loaded && <span className="skel absolute inset-0" aria-hidden="true" />}
      <img
        ref={ref}
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cx("h-full w-full object-cover", loaded ? "blur-in" : "opacity-0", imgClassName)}
      />
    </span>
  );
}

// Video tắt tiếng: chỉ phát khi đang trong màn hình (autoplay) hoặc khi rê chuột (hover); rời màn hình thì dừng.
export function SmartVideo({
  src,
  mode = "hover",
  className,
  poster,
  hovering,
}: {
  src: string;
  mode?: "hover" | "inview";
  className?: string;
  poster?: string;
  hovering?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const visible = useInView(ref);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const shouldPlay = visible && !reduce && (mode === "inview" || hovering);
    if (shouldPlay) v.play().catch(() => {});
    else {
      v.pause();
      if (mode === "hover" && !hovering && v.currentTime > 0.2) v.currentTime = 0.1;
    }
  }, [visible, hovering, mode]);

  return (
    <span className={cx("relative block overflow-hidden bg-s2", className)}>
      {!ready && <span className="skel absolute inset-0" aria-hidden="true" />}
      <video
        ref={ref}
        src={`${src}#t=0.1`}
        poster={poster}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        className={cx("h-full w-full object-cover transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}
      />
    </span>
  );
}
