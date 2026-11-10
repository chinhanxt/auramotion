"use client";

export default function AdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>Có lỗi xảy ra khi tải trang, vui lòng thử lại.</p>
      <button type="button" onClick={reset} className="rounded-md border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100">
        Thử lại
      </button>
    </div>
  );
}
