"use client";

import { useEffect, useRef, useState } from "react";
import { liteUrl, posterUrl, thumbSrcSet, thumbUrl } from "@/lib/media-url";
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

const POSITIONED = /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/;

// Ảnh hiện dần (blur → nét) khi tải xong. `skeleton={false}`: để nền của cha (gradient) hiện trong lúc tải.
export function FadeImage({
  src,
  alt,
  className,
  imgClassName,
  style,
  skeleton = true,
  w = 360,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  style?: React.CSSProperties;
  skeleton?: boolean;
  // Chiều rộng hiển thị (px): tải ảnh thu nhỏ vừa đủ (1x/2x) thay vì ảnh gốc.
  w?: number;
  onError?: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <span className={cx("block overflow-hidden", !POSITIONED.test(className ?? "") && "relative", className)} style={style}>
      {!loaded && skeleton && <span className="skel absolute inset-0" aria-hidden="true" />}
      <img
        ref={ref}
        src={thumbUrl(src, w * 2)}
        srcSet={thumbSrcSet(src, w)}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={onError}
        className={cx("h-full w-full object-cover", loaded ? "blur-in" : "opacity-0", imgClassName)}
      />
    </span>
  );
}

// Video tắt tiếng: chỉ phát khi đang trong màn hình (autoplay) hoặc khi rê chuột (hover); rời màn hình thì dừng.
// `plain`: không nền / skeleton (nền của cha hiện trong lúc tải); `onError` để cha rút về nền dự phòng.
export function SmartVideo({
  src,
  mode = "hover",
  className,
  poster,
  hovering,
  preload = "none",
  plain,
  onReady,
  onError,
}: {
  src: string;
  mode?: "hover" | "inview";
  className?: string;
  poster?: string;
  hovering?: boolean;
  preload?: "none" | "metadata" | "auto";
  plain?: boolean;
  onReady?: () => void;
  onError?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const visible = useInView(ref);
  const [ready, setReady] = useState(false);
  // Khung hình đầu (nhỏ) hiện ngay, video chỉ tải khi rê chuột / đang trong màn hình và được phát.
  const still = poster ?? posterUrl(src, 360);

  // Video có thể đã tải xong trước khi React gắn sự kiện (hydrate muộn).
  useEffect(() => {
    if ((ref.current?.readyState ?? 0) >= 2) setReady(true);
  }, []);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    if (ready) onReadyRef.current?.();
  }, [ready]);

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
    <span className={cx("block overflow-hidden", !plain && "bg-s2", !POSITIONED.test(className ?? "") && "relative", className)}>
      {!ready && !plain && <span className="skel absolute inset-0" aria-hidden="true" />}
      {still !== src && (
        <img src={still} alt="" loading="lazy" decoding="async" aria-hidden="true" className={cx("absolute inset-0 h-full w-full object-cover transition-opacity duration-500", ready && "opacity-0")} />
      )}
      <video
        ref={ref}
        src={`${liteUrl(src)}#t=0.1`}
        muted
        loop
        playsInline
        preload={preload}
        onLoadedData={() => setReady(true)}
        onCanPlay={() => setReady(true)}
        onError={onError}
        className={cx("h-full w-full object-cover transition-opacity duration-500", ready ? "opacity-100" : "opacity-0")}
      />
    </span>
  );
}
