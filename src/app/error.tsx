"use client";

export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="am flex flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="t-h2">Có lỗi xảy ra</h1>
      <p className="text-sm text-muted">Vui lòng thử lại sau giây lát.</p>
      <button type="button" onClick={reset} className="press h-10 rounded-m1 bg-accent px-5 text-sm font-semibold text-accent-ink">
        Thử lại
      </button>
    </main>
  );
}
