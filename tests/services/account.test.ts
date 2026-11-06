import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { sendMail } from "@/lib/mail";
import {
  loadSessionUser,
  registerUser,
  requestPasswordReset,
  resetPassword,
  upsertGoogleUser,
  verifyCredentials,
} from "@/server/services/account";
import { getBalance } from "@/server/services/credit";
import { getActivePlan } from "@/server/services/plan";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn(async () => undefined) }));

const PASSWORD = "matkhau123";

describe("account", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    vi.mocked(sendMail).mockClear();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("register creates free plan and 20 credits", async () => {
    const user = await registerUser({ email: "  An@Test.Local ", password: PASSWORD, name: "An" });
    expect(user.email).toBe("an@test.local");
    expect(user.passwordHash).not.toBe(PASSWORD);
    const { plan } = await getActivePlan(user.id);
    expect(plan.code).toBe("free");
    expect((await getBalance(user.id)).available.toFixed(2)).toBe("20.00");
  });

  it("register rejects short password", async () => {
    await expect(registerUser({ email: "a@test.local", password: "1234567", name: "A" })).rejects.toMatchObject({
      name: "ZodError",
    });
  });

  it("register duplicate email (case-insensitive)", async () => {
    await registerUser({ email: "dup@test.local", password: PASSWORD, name: "A" });
    await expect(registerUser({ email: "DUP@Test.local", password: PASSWORD, name: "B" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await db.user.count({ where: { email: "dup@test.local" } })).toBe(1);
  });

  it("verifyCredentials wrong password", async () => {
    const user = await registerUser({ email: "v@test.local", password: PASSWORD, name: "V" });
    expect(await verifyCredentials("v@test.local", "saimatkhau")).toBeNull();
    expect((await verifyCredentials("V@TEST.local", PASSWORD))?.id).toBe(user.id);
    await db.user.update({ where: { id: user.id }, data: { status: "LOCKED" } });
    expect(await verifyCredentials("v@test.local", PASSWORD)).toBeNull();
  });

  it("google links existing email account", async () => {
    const existing = await registerUser({ email: "g@test.local", password: PASSWORD, name: "G" });
    const linked = await upsertGoogleUser({ googleId: "gid-1", email: "G@test.local", name: "G Google" });
    expect(linked.id).toBe(existing.id);
    expect(linked.googleId).toBe("gid-1");
    expect(await db.subscription.count({ where: { userId: existing.id } })).toBe(1);

    const again = await upsertGoogleUser({ googleId: "gid-1", email: "doi-email@test.local", name: "G" });
    expect(again.id).toBe(existing.id);

    await expect(upsertGoogleUser({ googleId: "gid-khac", email: "g@test.local", name: "G" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: existing.id } })).googleId).toBe("gid-1");

    const fresh = await upsertGoogleUser({ googleId: "gid-2", email: "new@test.local", name: "New", avatarUrl: "https://x/a.png" });
    expect(fresh.passwordHash).toBeNull();
    expect(fresh.avatarUrl).toBe("https://x/a.png");
    expect((await getBalance(fresh.id)).available.toFixed(2)).toBe("20.00");
  });

  it("reset token single use", async () => {
    await registerUser({ email: "r@test.local", password: PASSWORD, name: "R" });
    await requestPasswordReset("nobody@test.local");
    expect(sendMail).not.toHaveBeenCalled();

    await requestPasswordReset("R@test.local");
    expect(sendMail).toHaveBeenCalledTimes(1);
    const html = vi.mocked(sendMail).mock.calls[0][2];
    const token = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(html)?.[1];
    expect(token).toBeTruthy();
    expect(await db.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await resetPassword(token!, "matkhaumoi1");
    expect(await verifyCredentials("r@test.local", "matkhaumoi1")).not.toBeNull();
    expect(await verifyCredentials("r@test.local", PASSWORD)).toBeNull();
    await expect(resetPassword(token!, "matkhaumoi2")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(resetPassword("token-sai", "matkhaumoi2")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("forgot password hides mail failure", async () => {
    await registerUser({ email: "m@test.local", password: PASSWORD, name: "M" });
    vi.mocked(sendMail).mockRejectedValueOnce(new Error("smtp down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(requestPasswordReset("m@test.local")).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it("reset token expires after 1 hour", async () => {
    const user = await registerUser({ email: "e@test.local", password: PASSWORD, name: "E" });
    await requestPasswordReset("e@test.local");
    const token = /token=([A-Za-z0-9_-]+)/.exec(vi.mocked(sendMail).mock.calls[0][2])![1];
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(resetPassword(token, "matkhaumoi1")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("requireUser rejects locked user", async () => {
    await expect(loadSessionUser(undefined)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(loadSessionUser("khong-ton-tai")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const user = await registerUser({ email: "l@test.local", password: PASSWORD, name: "L" });
    expect((await loadSessionUser(user.id)).id).toBe(user.id);
    await db.user.update({ where: { id: user.id }, data: { status: "LOCKED" } });
    await expect(loadSessionUser(user.id)).rejects.toMatchObject({ code: "ACCOUNT_LOCKED" });
  });
});
