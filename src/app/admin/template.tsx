// Mỗi lần đổi trang quản trị: hiện dần + nhích lên.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
