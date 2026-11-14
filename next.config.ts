import type { NextConfig } from "next";

// Tệp tĩnh trong public/ (video minh họa, logo, nhạc, bìa) mặc định không có cache: cho trình duyệt giữ 1 ngày,
// hết hạn vẫn hiện bản cũ trong lúc tải bản mới (stale-while-revalidate).
const STATIC_CACHE = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return ["/showcase/:path*", "/brand/:path*", "/presets/:path*", "/music/:path*"].map((source) => ({ source, headers: STATIC_CACHE }));
  },
};

export default nextConfig;
