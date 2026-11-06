import Link from "next/link";
import { AdminNav } from "@/components/admin/AdminNav";
import { SignOutButton } from "@/components/layout/UserNav";
import { adminPage } from "./guard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quản trị · AuraMotion" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await adminPage();
  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 md:flex">
      <AdminNav />
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between gap-3 border-b border-neutral-200 bg-white px-4 py-3">
          <Link href="/admin" className="font-semibold md:hidden">
            AuraMotion Admin
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <Link href="/studio/image" className="text-neutral-600 hover:underline">
              Về Studio
            </Link>
            <span className="hidden max-w-40 truncate text-neutral-600 sm:inline">{admin.name}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
