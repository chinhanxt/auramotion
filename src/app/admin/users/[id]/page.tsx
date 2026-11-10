import { notFound } from "next/navigation";
import { UserDetailView } from "@/components/admin/biz/UserDetailView";
import { plain } from "@/components/admin/plain";
import { AppError } from "@/lib/errors";
import { getUserDetail } from "@/server/services/admin";
import { adminPage } from "../../guard";

export default async function AdminUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await adminPage();
  const { id } = await params;
  const detail = await getUserDetail(id).catch((err: unknown) => {
    if (err instanceof AppError && err.code === "NOT_FOUND") notFound();
    throw err;
  });
  return <UserDetailView data={plain(detail)} self={detail.user.id === admin.id} />;
}
