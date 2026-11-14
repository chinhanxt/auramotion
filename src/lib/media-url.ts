// URL ảnh thu nhỏ / khung hình xem trước do /media sinh sẵn (cache vĩnh viễn). URL ngoài /media giữ nguyên.
const isMedia = (u: string) => u.startsWith("/media/") && !u.includes("?");

export function thumbUrl(url: string, w: number): string {
  return isMedia(url) ? `${url}?w=${w}` : url;
}

// Bản video nhẹ để xem trước (360p); xem phóng to / tải về vẫn dùng URL gốc.
export function liteUrl(url: string): string {
  return isMedia(url) ? `${url}?lite=1` : url;
}

export function posterUrl(url: string, w: number): string {
  return isMedia(url) ? `${url}?poster=${w}` : url;
}

// srcSet 1x / 2x cho màn hình retina.
export function thumbSrcSet(url: string, w: number): string | undefined {
  return isMedia(url) ? `${thumbUrl(url, w)} 1x, ${thumbUrl(url, w * 2)} 2x` : undefined;
}
