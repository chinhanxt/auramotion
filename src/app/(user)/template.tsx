// Mỗi lần đổi trang: hiện dần + nhích lên 8px.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
