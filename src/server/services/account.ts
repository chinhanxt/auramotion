import { createHash, randomBytes } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sendMail } from "@/lib/mail";
import { startFree } from "@/server/services/plan";

const RESET_TTL_MS = 60 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "Email không hợp lệ" }));
const passwordSchema = z.string().min(8, { error: "Mật khẩu tối thiểu 8 ký tự" }).max(200);
const nameSchema = z.string().trim().min(1, { error: "Vui lòng nhập tên" }).max(100);

const registerSchema = z.object({ email: emailSchema, password: passwordSchema, name: nameSchema });
const profileSchema = z.object({
  name: nameSchema.optional(),
  avatarUrl: z.string().trim().max(2000).nullable().optional(),
});

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function registerUser(input: { email: string; password: string; name: string }): Promise<User> {
  const { email, password, name } = registerSchema.parse(input);
  if (await db.user.findUnique({ where: { email } })) {
    throw new AppError("CONFLICT", "Email đã được sử dụng");
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name, passwordHash } });
      await startFree(user.id, tx);
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("CONFLICT", "Email đã được sử dụng");
    throw err;
  }
}

export async function verifyCredentials(email: string, password: string): Promise<User | null> {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user?.passwordHash || user.status === "LOCKED") return null;
  return (await bcrypt.compare(password, user.passwordHash)) ? user : null;
}

export async function upsertGoogleUser(input: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const byGoogle = await db.user.findUnique({ where: { googleId: input.googleId } });
  if (byGoogle) return byGoogle;

  const byEmail = await db.user.findUnique({ where: { email } });
  if (byEmail) {
    return db.user.update({
      where: { id: byEmail.id },
      data: { googleId: input.googleId, avatarUrl: byEmail.avatarUrl ?? input.avatarUrl ?? null },
    });
  }

  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          googleId: input.googleId,
          name: input.name.trim() || email.split("@")[0],
          avatarUrl: input.avatarUrl ?? null,
        },
      });
      await startFree(user.id, tx);
      return user;
    });
  } catch (err) {
    // Hai lần đăng nhập Google song song: lần sau thua unique thì lấy user lần trước đã tạo.
    if (isUniqueViolation(err)) return db.user.findUniqueOrThrow({ where: { googleId: input.googleId } });
    throw err;
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  const user = await db.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) return;
  const token = randomBytes(32).toString("base64url");
  await db.passwordResetToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;
  await sendMail(
    user.email,
    "Đặt lại mật khẩu AuraMotion",
    `<p>Chào ${user.name},</p>` +
      `<p>Bấm vào liên kết sau để đặt lại mật khẩu (hiệu lực 1 giờ):</p>` +
      `<p><a href="${link}">${link}</a></p>` +
      `<p>Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>`,
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const password = passwordSchema.parse(newPassword);
  const invalid = new AppError("VALIDATION", "Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn");
  const record = await db.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt <= new Date()) throw invalid;
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await db.$transaction(async (tx) => {
    const used = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (used.count !== 1) throw invalid;
    await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
  });
}

export async function updateProfile(
  userId: string,
  input: { name?: string; avatarUrl?: string | null },
): Promise<User> {
  const data = profileSchema.parse(input);
  return db.user.update({ where: { id: userId }, data });
}

export async function changePassword(userId: string, oldPw: string, newPw: string): Promise<void> {
  const password = passwordSchema.parse(newPw);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  // Tài khoản chỉ đăng nhập Google chưa có mật khẩu: cho đặt mật khẩu lần đầu.
  if (user.passwordHash && !(await bcrypt.compare(oldPw, user.passwordHash))) {
    throw new AppError("VALIDATION", "Mật khẩu hiện tại không đúng");
  }
  await db.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) } });
}

export async function loadSessionUser(userId: string | undefined): Promise<User> {
  if (!userId) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
  if (user.status === "LOCKED") throw new AppError("ACCOUNT_LOCKED", "Tài khoản đã bị khóa");
  return user;
}
