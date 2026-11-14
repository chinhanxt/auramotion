import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { storagePath } from "@/lib/storage";
import { createMusicTrack, deleteMusicTrack, listMusic, saveMusicUpload } from "@/server/services/admin";
import { createOrder } from "@/server/services/payment";
import { getPaymentQr, removePaymentQr, savePaymentQr } from "@/server/services/payment-qr";
import { startFree } from "@/server/services/plan";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

function wav(): File {
  const f = path.join(os.tmpdir(), `am-test-${Date.now()}.wav`);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", f]);
  const buf = fs.readFileSync(f);
  fs.rmSync(f);
  return new File([buf], "Bài Nhạc Thử Đẹp.wav", { type: "audio/wav" });
}

describe("admin uploads", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    fs.rmSync(path.dirname(storagePath("music/x")), { recursive: true, force: true });
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("nhạc: tải lên, thêm bài, xóa bài thì xóa luôn file đã tải", async () => {
    const up = await saveMusicUpload(wav());
    expect(up).toMatchObject({ file: "/media/music/bai-nhac-thu-dep.wav", suggestedId: "bai-nhac-thu-dep", suggestedName: "Bài Nhạc Thử Đẹp" });
    expect((await listMusic()).files).toContain(up.file);
    const track = await createMusicTrack({ id: up.suggestedId, name: up.suggestedName, file: up.file });
    expect(track.file).toBe(up.file);
    const again = await saveMusicUpload(wav());
    expect(again.file).toBe("/media/music/bai-nhac-thu-dep-2.wav");
    await deleteMusicTrack(track.id);
    expect(fs.existsSync(storagePath("music/bai-nhac-thu-dep.wav"))).toBe(false);
  });

  it("nhạc: từ chối file giả âm thanh và đuôi lạ", async () => {
    await expect(saveMusicUpload(new File(["không phải nhạc"], "gia.mp3"))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveMusicUpload(new File(["x"], "doc.pdf"))).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await listMusic()).files.filter((f) => f.startsWith("/media/music/"))).toEqual([]);
  });

  it("QR: tải ảnh lên thì thanh toán dùng ảnh đó, gỡ thì quay về QR tự sinh", async () => {
    const user = await db.user.create({ data: { email: "qr@test.local", name: "qr" } });
    await startFree(user.id);
    const before = await createOrder(user.id, { type: "CREDIT", credits: 100 });
    expect(before.qrStatic).toBe(false);
    expect(before.qrUrl).toMatch(/^https:\/\/img\.vietqr\.io\//);

    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#fff" } }).png().toBuffer();
    const saved = await savePaymentQr(new File([png], "qr.png", { type: "image/png" }), "Quét bằng app ngân hàng");
    expect(saved.url).toMatch(/^\/media\/payment\/qr-\d+\.png$/);
    expect(fs.existsSync(storagePath(saved.url.slice("/media/".length)))).toBe(true);
    const after = await createOrder(user.id, { type: "CREDIT", credits: 500 });
    expect(after).toMatchObject({ qrStatic: true, qrUrl: saved.url, qrNote: "Quét bằng app ngân hàng" });

    await expect(savePaymentQr(new File(["không phải ảnh"], "x.png"))).rejects.toMatchObject({ code: "VALIDATION" });
    await removePaymentQr();
    expect(await getPaymentQr()).toBeNull();
    expect(fs.existsSync(storagePath(saved.url.slice("/media/".length)))).toBe(false);
  });
});
