import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/account/ProfileForm";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Hồ sơ · AuraMotion" };

export default async function ProfilePage() {
  const user = await requireUser().catch(() => null);
  if (!user) redirect("/login");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Hồ sơ</h1>
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
