import { requireAdmin } from "@/lib/auth";
import { handle, readJson } from "@/lib/http";
import { importMuseAccounts, listMuseAccounts } from "@/server/services/admin-ops";

export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listMuseAccounts();
  });
}

// Body: { label?, cookies } hoặc { accounts: [{ label?, cookies }] } (cookie JSON xuất từ trình duyệt).
export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return importMuseAccounts(await readJson(req));
  });
}
