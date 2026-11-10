import { MusicView } from "@/components/admin/biz/MusicView";
import { listMusic } from "@/server/services/admin";
import { adminPage } from "../guard";

export default async function AdminMusicPage() {
  await adminPage();
  return <MusicView data={await listMusic()} />;
}
