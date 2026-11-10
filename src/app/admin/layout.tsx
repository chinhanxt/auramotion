import { AdminShell } from "@/components/admin/AdminShell";
import { adminPage } from "./guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quản trị · AuraMotion" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await adminPage();
  return <AdminShell admin={{ name: admin.name, email: admin.email, avatarUrl: admin.avatarUrl }}>{children}</AdminShell>;
}
