import Link from "next/link";

export default function UserNotFound() {
  return (
    <div className="space-y-3 text-sm text-neutral-600">
      <p>Không tìm thấy nội dung này. Có thể đã bị xóa hoặc không thuộc tài khoản của bạn.</p>
      <Link href="/library" className="font-medium text-neutral-900 underline">
        Về Thư viện
      </Link>
    </div>
  );
}
