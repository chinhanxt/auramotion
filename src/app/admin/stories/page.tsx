import { StoriesView } from "@/components/admin/content/StoriesView";
import { plain } from "@/components/admin/plain";
import { adminStoryQuery, listAdminStories } from "@/server/services/story";
import { adminPage, one, type SearchParams } from "../guard";

export default async function AdminStoriesPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const parsed = adminStoryQuery.safeParse({ status: one(sp.status), user: one(sp.user), page: one(sp.page) });
  const result = await listAdminStories(parsed.success ? parsed.data : {});
  return <StoriesView data={plain(result)} />;
}
