// Sinh trước ảnh thu nhỏ / khung hình / bản video nhẹ cho mọi kết quả đã có.
// Dùng: npx tsx --env-file=.env scripts/warm-media.ts
import { db } from "@/lib/db";
import { warmMedia } from "@/lib/thumb";

async function main() {
  const jobs = await db.job.findMany({ where: { status: "SUCCEEDED", deletedAt: null, resultUrls: { isEmpty: false } }, select: { resultUrls: true }, orderBy: { createdAt: "desc" } });
  let n = 0;
  for (const j of jobs) {
    await warmMedia(j.resultUrls);
    n += j.resultUrls.length;
  }
  console.log(`đã xử lý ${n} tệp`);
  await new Promise((r) => setTimeout(r, 60_000)); // chờ ffmpeg nền xong bản nhẹ
  await db.$disconnect();
  process.exit(0);
}
main();
