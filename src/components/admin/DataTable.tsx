import Link from "next/link";

export type Column<T> = { header: string; cell: (row: T) => React.ReactNode; className?: string };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty = "Không có dữ liệu",
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-500">
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-3 py-2 whitespace-nowrap ${c.className ?? ""}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-neutral-500">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="align-top">
                {columns.map((c) => (
                  <td key={c.header} className={`px-3 py-2 ${c.className ?? ""}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// Phân trang bằng query string: giữ nguyên các bộ lọc, chỉ đổi `page`.
export function Pager({
  basePath,
  query,
  page,
  total,
  pageSize,
}: {
  basePath: string;
  query: Record<string, string | undefined>;
  page: number;
  total: number;
  pageSize: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
    qs.set("page", String(p));
    return `${basePath}?${qs}`;
  };
  const link = "rounded-md border border-neutral-300 bg-white px-3 py-1.5 hover:bg-neutral-100";
  return (
    <div className="flex items-center justify-between text-sm text-neutral-600">
      <span>
        {total.toLocaleString("vi-VN")} mục · trang {page}/{pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className={link}>
            Trước
          </Link>
        )}
        {page < pages && (
          <Link href={href(page + 1)} className={link}>
            Sau
          </Link>
        )}
      </div>
    </div>
  );
}

// Badge trạng thái đơn giản.
export function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${className}`}>{children}</span>;
}
