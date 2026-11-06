import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { handle, readJson } from "@/lib/http";
import { createPreset, deletePreset, listPresets, updatePreset } from "@/server/services/admin";

export function GET(): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return listPresets();
  });
}

export function POST(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return createPreset(await readJson(req));
  });
}

export function PATCH(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    return updatePreset(await readJson(req));
  });
}

export function DELETE(req: Request): Promise<Response> {
  return handle(async () => {
    await requireAdmin();
    const id = new URL(req.url).searchParams.get("id");
    if (!id) throw new AppError("VALIDATION", "Thiếu id");
    return deletePreset(id);
  });
}
