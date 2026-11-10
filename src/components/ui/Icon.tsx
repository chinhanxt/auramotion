// Bộ icon nét 1.6, khung 20px. Thêm icon: một dòng trong PATHS.
const PATHS = {
  sparkle: "M10 2.5l1.6 4.4a2 2 0 0 0 1.2 1.2l4.4 1.6-4.4 1.6a2 2 0 0 0-1.2 1.2L10 17.5l-1.6-4.4a2 2 0 0 0-1.2-1.2L2.8 10.3l4.4-1.6a2 2 0 0 0 1.2-1.2z",
  image: "M3.5 5.5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM3.8 13.6l3.6-3.6a1.4 1.4 0 0 1 2 0l5.3 5.3M11.6 11.9l1.3-1.3a1.4 1.4 0 0 1 2 0l1.6 1.6M12.5 7.2h.01",
  video: "M3 6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM14 8.3l3.2-2a.5.5 0 0 1 .8.4v6.6a.5.5 0 0 1-.8.4l-3.2-2",
  story: "M3.5 4.5h4v11h-4zM8 4.5h4v11H8zM12.5 4.5h4v11h-4z",
  cut: "M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6 16.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8 7.5l9 7M8 12.5l9-7",
  grid: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z",
  compass: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12.8 7.2l-1.6 4-4 1.6 1.6-4z",
  library: "M4 3.5v13M7.5 3.5v13M11 4l4.5 12.2",
  plus: "M10 4v12M4 10h12",
  minus: "M4 10h12",
  close: "M5 5l10 10M15 5L5 15",
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  arrowRight: "M4 10h12M11 5l5 5-5 5",
  arrowLeft: "M16 10H4M9 5l-5 5 5 5",
  arrowUp: "M10 16V4M5 9l5-5 5 5",
  chevronDown: "M5.5 8l4.5 4.5L14.5 8",
  chevronLeft: "M12 5l-5 5 5 5",
  chevronRight: "M8 5l5 5-5 5",
  chevronUp: "M5.5 12.5L10 8l4.5 4.5",
  download: "M10 3.5v9M6 9l4 4 4-4M4 16.5h12",
  refresh: "M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3",
  trash: "M4 6h12M8 6V4.5h4V6M5.5 6l.7 9.4a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4L14.5 6",
  play: "M6.5 4.5v11l9-5.5z",
  pause: "M6.5 4.5v11M13.5 4.5v11",
  stop: "M5.5 5.5h9v9h-9z",
  volume: "M3.5 8v4h3l4 3.5v-11l-4 3.5zM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.5 6.5 0 0 1 0 9",
  mic: "M10 12.5a2.5 2.5 0 0 0 2.5-2.5V5.5a2.5 2.5 0 0 0-5 0V10a2.5 2.5 0 0 0 2.5 2.5zM5.5 9.5a4.5 4.5 0 0 0 9 0M10 14v2.5",
  music: "M7.5 15V5l9-1.5v10M7.5 15a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM16.5 13.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  text: "M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5",
  subtitles: "M3 5.5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM6 11.5h3M11 11.5h3M6 14h8",
  camera: "M3 7a2 2 0 0 1 2-2h1.5L8 3.5h4L13.5 5H15a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  palette: "M10 17a7 7 0 1 1 7-7c0 1.7-1.3 2.5-2.8 2.5h-1.5a1.6 1.6 0 0 0-1.2 2.7c.6.8.2 1.8-1.5 1.8zM6.5 9.5h.01M8.5 6.5h.01M12 6.5h.01",
  ratio: "M3.5 6a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2zM7 8v4M13 8v4",
  clock: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 6v4l2.5 2",
  layers: "M10 3l7 4-7 4-7-4zM3 11l7 4 7-4",
  cpu: "M6 6h8v8H6zM8 3v3M12 3v3M8 14v3M12 14v3M3 8h3M3 12h3M14 8h3M14 12h3",
  sliders: "M4 6h7M15 6h1M4 14h1M9 14h7M13 4v4M7 12v4",
  upload: "M10 13V3.5M6 7.5l4-4 4 4M4 16.5h12",
  link: "M8.5 11.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-.8.8M11.5 8.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l.8-.8",
  copy: "M7 7V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5v7a1.5 1.5 0 0 1-1.5 1.5H13M3 8.5A1.5 1.5 0 0 1 4.5 7h7A1.5 1.5 0 0 1 13 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 3 15.5z",
  user: "M10 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 17a6.5 6.5 0 0 1 13 0",
  logout: "M8 4H5.5A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8M12 6.5L15.5 10 12 13.5M15.5 10H8",
  shield: "M10 2.8l6 2.2v4.6c0 3.8-2.6 6.4-6 7.6-3.4-1.2-6-3.8-6-7.6V5z",
  tag: "M3.5 3.5h6l7 7-6 6-7-7zM7 7h.01",
  coin: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 15a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM10 7.7l1.6 2.3-1.6 2.3-1.6-2.3z",
  bolt: "M11 2.5L4.5 11H10l-1 6.5L15.5 9H10z",
  wand: "M4 16l9-9M12 4l1-1M15 7l1.5-.5M13 3.5V2M16.5 4L18 3.5M11 8.5l1.5 1.5",
  frame: "M3.5 7V4.5a1 1 0 0 1 1-1H7M13 3.5h2.5a1 1 0 0 1 1 1V7M16.5 13v2.5a1 1 0 0 1-1 1H13M7 16.5H4.5a1 1 0 0 1-1-1V13",
  lock: "M5.5 9h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM7 9V6.5a3 3 0 0 1 6 0V9",
  more: "M5 10h.01M10 10h.01M15 10h.01",
  drag: "M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01",
  alert: "M10 3l8 14H2zM10 8v4M10 14.5h.01",
  info: "M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 9v5M10 6.5h.01",
  eye: "M2.5 10S5.2 4.5 10 4.5 17.5 10 17.5 10 14.8 15.5 10 15.5 2.5 10 2.5 10zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  qr: "M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h2v2h-2zM14.5 14.5h2v2h-2zM14.5 11.5h2M11.5 15.5v1",
  edit: "M12.5 4.5l3 3L7 16H4v-3zM11 6l3 3",
  film: "M3.5 3.5h13v13h-13zM6.5 3.5v13M13.5 3.5v13M3.5 7h3M3.5 13h3M13.5 7h3M13.5 13h3M3.5 10h13",
  search: "M9 15.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM14 14l3.5 3.5",
  menu: "M3.5 6h13M3.5 10h13M3.5 14h13",
  star: "M10 2.8l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z",
  list: "M7 5.5h9.5M7 10h9.5M7 14.5h9.5M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01",
  gauge: "M3 14a7 7 0 1 1 14 0M10 14l3.2-4.2M3.5 17h13",
  route: "M5 16.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 7.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 12.5V10a3 3 0 0 1 3-3h5",
  users: "M7.5 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2.5 16.5a5 5 0 0 1 10 0M13 3.8a3 3 0 0 1 0 5.4M14.5 11.8a5 5 0 0 1 3 4.7",
  card: "M2.5 5.5A1.5 1.5 0 0 1 4 4h12a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5zM2.5 8h15M5.5 13h3",
  gear: "M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4",
  server: "M3.5 4.5h13V9h-13zM3.5 11h13v4.5h-13zM6 6.75h.01M6 13.25h.01",
  pulse: "M2.5 10h3l2-5 4 10 2-5h4",
  external: "M11 3.5h5.5V9M16.5 3.5L9 11M14 11.5V15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 4 15V8a1.5 1.5 0 0 1 1.5-1.5H9",
  google: "",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, strokeWidth = 1.6 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
  if (name === "google") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

// Đồng xu Credit màu vàng (pill số dư, chỗ cần đọc ra "tiền" ngay).
export function CoinMark({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="#f5c84b" />
      <circle cx="10" cy="10" r="8" fill="none" stroke="#ffe28a" strokeOpacity=".55" strokeWidth="1" />
      <circle cx="10" cy="10" r="5.3" fill="none" stroke="#9a6a12" strokeOpacity=".55" strokeWidth="1.3" />
      <path d="M10 7.4l1.7 2.6-1.7 2.6-1.7-2.6z" fill="#8a5c0c" fillOpacity=".75" />
    </svg>
  );
}
