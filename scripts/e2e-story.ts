// Chạy thật 1 Story qua service + worker đang chạy (Muse thật). Dùng: npx tsx --env-file=.env scripts/e2e-story.ts
import { db } from "@/lib/db";
import { adminAdjust, getBalance } from "@/server/services/credit";
import { registerUser } from "@/server/services/account";
import { createStory, getStory } from "@/server/services/story";

const EMAIL = "e2e@auramotion.local";

async function main() {
  let user = await db.user.findUnique({ where: { email: EMAIL } });
  if (!user) {
    await registerUser({ email: EMAIL, name: "E2E", password: "e2e-password-123" });
    user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
  }
  const admin = await db.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  await db.subscription.updateMany({ where: { userId: user.id, status: "ACTIVE" }, data: { status: "EXPIRED" } });
  const ultra = await db.plan.findUniqueOrThrow({ where: { code: "ultra" } });
  await db.subscription.create({ data: { userId: user.id, planId: ultra.id, period: "MONTH", endAt: new Date(Date.now() + 30 * 864e5), nextGrantAt: new Date(Date.now() + 30 * 864e5) } });
  if (Number((await getBalance(user.id)).available) < 100) await adminAdjust(user.id, 200, admin.id, "e2e");
  const style = await db.preset.findFirst({ where: { slug: process.env.STYLE ?? "cyber-lotus-saigon" } });
  const skill = await db.promptSkill.findFirst({ where: { kind: "STORY", enabled: true }, orderBy: { sort: "asc" } });
  const story = await createStory(user.id, {
    idea: process.env.IDEA ?? "Một chiếc thuyền giấy trôi qua con hẻm Sài Gòn mưa đêm, đèn neon phản chiếu, kết thúc ở bến sông lúc bình minh",
    styleId: style?.id, skillId: skill?.id, aspect: "9:16", shotCount: Number(process.env.SHOTS ?? 3), shotDurationSec: 5,
    mode: (process.env.MODE as "PARALLEL" | "CHAIN") ?? "PARALLEL", autoRun: true, autoAssemble: true,
  });
  console.log("story", story.id, "style", style?.name, "skill", skill?.name);
  const t0 = Date.now();
  let last = "";
  for (;;) {
    const s = await getStory(user.id, story.id);
    const jobs = await db.job.findMany({ where: { storyId: story.id }, orderBy: { shotIndex: "asc" } });
    const line = `${s.story.status} | ` + jobs.map((j) => `#${j.shotIndex}:${j.status}:${j.progress}`).join(" ");
    if (line !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)}s ${line}`); last = line; }
    if (["DONE","FAILED","CANCELED"].includes(s.story.status)) {
      console.log(JSON.stringify({ plan: s.plan, error: s.error, finalJobId: s.finalJobId }, null, 1).slice(0, 3000));
      if (s.finalJobId) console.log(JSON.stringify(await db.job.findUnique({ where: { id: s.finalJobId }, select: { status: true, resultUrls: true, error: true } })));
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("balance", JSON.stringify(await getBalance(user.id)));
  await db.$disconnect();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
