import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle } from "@/lib/http";
import { getActivePlan } from "@/server/services/plan";
import { getSetting } from "@/server/services/settings";

const kindSchema = z.enum(["image", "video", "assemble"], { message: "Loại tác vụ không hợp lệ" });

const MODEL_KIND = { image: "IMAGE", video: "VIDEO", assemble: "ASSEMBLE" } as const;
const PRESET_KIND = { image: "STYLE", video: "CAMERA" } as const;

type MusicTrack = { id: string; name: string; file: string };

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const kind = kindSchema.parse(new URL(req.url).searchParams.get("kind"));
    const { plan } = await getActivePlan(user.id);
    const models = await db.aiModel.findMany({
      where: { kind: MODEL_KIND[kind], enabled: true },
      orderBy: [{ sort: "asc" }, { name: "asc" }],
    });
    const presets =
      kind === "assemble"
        ? []
        : await db.preset.findMany({ where: { kind: PRESET_KIND[kind], enabled: true }, orderBy: { name: "asc" } });
    const music = kind === "assemble" ? await getSetting<MusicTrack[]>("music_tracks").catch(() => []) : undefined;
    return {
      models: models.map((m) => ({ ...m, locked: m.minPlanRank > plan.rank })),
      presets,
      plan,
      ...(music ? { music } : {}),
    };
  });
}
