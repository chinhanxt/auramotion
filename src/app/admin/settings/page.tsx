import { SettingsView } from "@/components/admin/biz/SettingsView";
import { getAdminSettings, listMusic } from "@/server/services/admin";
import { DEFAULT_STORY_SETTING } from "@/server/services/story";
import { adminPage } from "../guard";

export default async function AdminSettingsPage() {
  await adminPage();
  const [s, music] = await Promise.all([getAdminSettings(), listMusic()]);
  const story = { ...DEFAULT_STORY_SETTING, ...(s.story ?? {}) };
  return (
    <SettingsView
      maintenance={Boolean(s.maintenance)}
      promptWriter={s.prompt_writer ?? { provider: "agy", model: "" }}
      story={{ ...story, assemble: { ...DEFAULT_STORY_SETTING.assemble, ...(story.assemble ?? {}) } }}
      packs={Array.isArray(s.credit_packs) ? s.credit_packs : []}
      museSlots={s.muse_slots ?? null}
      gateway={s.ai_gateway ? { order: s.ai_gateway.order, timeoutSec: s.ai_gateway.timeoutSec } : null}
      tracks={music.tracks.map((t) => ({ id: t.id, name: t.name }))}
    />
  );
}
