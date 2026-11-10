import { FeaturedView } from "@/components/admin/content/FeaturedView";
import { plain } from "@/components/admin/plain";
import { db } from "@/lib/db";
import { listAdminJobs } from "@/server/services/admin";
import { adminPage, one, type SearchParams } from "../guard";

const KINDS = ["IMAGE", "VIDEO", "ASSEMBLE"] as const;

export default async function AdminFeaturedPage({ searchParams }: { searchParams: SearchParams }) {
  await adminPage();
  const sp = await searchParams;
  const kindRaw = one(sp.kind);
  const kind = KINDS.find((k) => k === kindRaw);
  const featuredRaw = one(sp.featured);
  const featured = featuredRaw === "1" || featuredRaw === "0" ? featuredRaw : undefined;
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const [result, featuredTotal] = await Promise.all([
    listAdminJobs({ status: "SUCCEEDED", kind, featured, page, pageSize: 36 }),
    db.job.count({ where: { status: "SUCCEEDED", featured: true } }),
  ]);
  const items = result.items.map((j) => ({
    id: j.id,
    kind: j.kind,
    prompt: j.prompt,
    resultUrls: j.resultUrls,
    params: j.params,
    featured: j.featured,
    deletedAt: j.deletedAt,
    createdAt: j.createdAt,
    user: j.user,
    model: j.model,
  }));
  return <FeaturedView data={plain({ items, total: result.total, page: result.page, pageSize: result.pageSize })} featuredTotal={featuredTotal} />;
}
