import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/account/ProfileForm";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Hồ sơ · AuraMotion" };

export default async function ProfilePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-[1200px] px-3 pt-3 pb-16 sm:px-5 lg:px-6">
      <h1 className="t-h2 mb-5">Hồ sơ</h1>
      <ProfileForm
        user={{
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          hasPassword: user.passwordHash !== null,
          googleLinked: user.googleId !== null,
        }}
      />
    </div>
  );
}
