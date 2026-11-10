// Theo dõi 1 story tới khi xong. Dùng: npx tsx --env-file=.env scripts/e2e-watch.ts <storyId>
import { db } from "@/lib/db";
async function main() {
const id = process.argv[2];
const t0 = Date.now();
let last = "";
for (;;) {
  const s = await db.story.findUniqueOrThrow({ where: { id } });
  const jobs = await db.job.findMany({ where: { storyId: id }, orderBy: [{ shotIndex: "asc" }, { createdAt: "asc" }] });
  const line = `${s.status} | ` + jobs.map((j) => `${j.kind[0]}${j.shotIndex ?? ""}:${j.status}:${j.progress}${j.error ? ":" + j.error : ""}`).join(" ");
  if (line !== last) { console.log(`${Math.round((Date.now() - t0) / 1000)}s ${line}`); last = line; }
  if (["DONE", "FAILED", "CANCELED"].includes(s.status)) {
    console.log(JSON.stringify({ title: s.title, plan: s.plan, error: s.error, finalJobId: s.finalJobId }, null, 1).slice(0, 4000));
    for (const j of jobs) console.log(j.kind, j.shotIndex, j.status, j.resultUrls.join(","), JSON.stringify(j.params).slice(0, 300));
    break;
  }
  await new Promise((r) => setTimeout(r, 3000));
}
await db.$disconnect();
process.exit(0);
}
void main();
