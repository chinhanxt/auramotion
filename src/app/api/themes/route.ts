import { handle } from "@/lib/http";
import { getThemes } from "@/server/services/catalog";

export const dynamic = "force-dynamic";

// Công khai: theme STYLE + CAMERA cho landing.
export function GET(): Promise<Response> {
  return handle(() => getThemes());
}
