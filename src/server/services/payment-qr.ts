import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { AppError } from "@/lib/errors";
import { storagePath } from "@/lib/storage";
import { getSetting, setSetting } from "@/server/services/settings";

// Mã QR nhận tiền do admin tải lên (ảnh QR ngân hàng / ví). Có thì trang thanh toán dùng ảnh này thay cho QR tự sinh (VietQR).
export const MAX_QR_BYTES = 4 * 1024 * 1024;
type QrSetting = { url: string; updatedAt: string; note?: string } | null;

export async function getPaymentQr(): Promise<{ url: string; updatedAt: string; note?: string } | null> {
  const v = await getSetting<QrSetting>("payment_qr").catch(() => null);
  return v && typeof v.url === "string" && v.url ? v : null;
}

export async function savePaymentQr(file: File, note?: string): Promise<{ url: string; updatedAt: string; note?: string }> {
  if (file.size === 0) throw new AppError("VALIDATION", "File rỗng");
  if (file.size > MAX_QR_BYTES) throw new AppError("VALIDATION", "Ảnh QR tối đa 4 MB");
  const input = Buffer.from(await file.arrayBuffer());
  let png: Buffer;
  try {
    const meta = await sharp(input, { failOn: "error" }).metadata();
    if (!meta.width || !meta.height) throw new Error("no size");
    // Chuẩn hóa: bỏ metadata, tối đa 1000 px, PNG nét (QR cần cạnh sắc).
    png = await sharp(input).rotate().resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  } catch {
    throw new AppError("VALIDATION", "File không phải ảnh hợp lệ (PNG, JPG hoặc WebP)");
  }
  const stamp = Date.now();
  const key = `payment/qr-${stamp}.png`;
  const target = storagePath(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, png);
  const prev = await getPaymentQr();
  const value = { url: `/media/${key}`, updatedAt: new Date(stamp).toISOString(), ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}) };
  await setSetting("payment_qr", value);
  if (prev) await fs.rm(storagePath(prev.url.slice("/media/".length)), { force: true }).catch(() => undefined);
  return value;
}

export async function removePaymentQr(): Promise<void> {
  const prev = await getPaymentQr();
  await setSetting("payment_qr", {});
  if (prev) await fs.rm(storagePath(prev.url.slice("/media/".length)), { force: true }).catch(() => undefined);
}
