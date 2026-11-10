import type { User } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { startFree } from "@/server/services/plan";
import { seed } from "../../prisma/seed";
import { resetDb } from "../helpers/db";

const current: { user: User | null } = { user: null };

vi.mock("@/lib/auth", async () => {
  const { AppError } = await import("@/lib/errors");
  return {
    requireUser: async () => {
      if (!current.user) throw new AppError("UNAUTHORIZED", "Vui lòng đăng nhập");
      return current.user;
    },
  };
});

const { GET } = await import("@/app/api/catalog/route");

type CatalogBody = {
  models: { name: string; kind: string; locked: boolean }[];
  presets: { kind: string; name: string }[];
  plan: { code: string; rank: number };
  music?: { id: string; name: string; file: string }[];
};

async function getCatalog(kind: string): Promise<{ status: number; body: CatalogBody }> {
  const res = await GET(new Request(`http://localhost/api/catalog?kind=${kind}`));
  return { status: res.status, body: (await res.json()) as CatalogBody };
}

describe("GET /api/catalog", () => {
  beforeEach(async () => {
    await resetDb();
    await seed();
    current.user = await db.user.create({ data: { email: "catalog@test.local", name: "Catalog" } });
    await startFree(current.user.id);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("free user image: codex locked, muse unlocked, only STYLE presets", async () => {
    const { status, body } = await getCatalog("image");
    expect(status).toBe(200);
    expect(body.plan.code).toBe("free");
    const byName = Object.fromEntries(body.models.map((m) => [m.name, m]));
    expect(byName["Codex Ảnh"].locked).toBe(true);
    expect(byName["MUSE Ảnh"].locked).toBe(false);
    expect(byName["Gemini Ảnh"].locked).toBe(false);
    expect(body.models.every((m) => m.kind === "IMAGE")).toBe(true);
    expect(body.models.map((m) => m.name)).toEqual(["MUSE Ảnh", "Gemini Ảnh", "Codex Ảnh"]);
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets.every((p) => p.kind === "STYLE")).toBe(true);
    expect(body.music).toBeUndefined();
  });

  it("video returns only CAMERA presets", async () => {
    const { body } = await getCatalog("video");
    expect(body.models.map((m) => m.name)).toEqual(["MUSE Video"]);
    expect(body.presets.length).toBeGreaterThan(0);
    expect(body.presets.every((p) => p.kind === "CAMERA")).toBe(true);
  });

  it("disabled model and preset are hidden", async () => {
    await db.aiModel.update({ where: { name: "MUSE Video" }, data: { enabled: false } });
    await db.preset.update({ where: { kind_name: { kind: "CAMERA", name: "Zoom In" } }, data: { enabled: false } });
    const { body } = await getCatalog("video");
    expect(body.models).toEqual([]);
    expect(body.presets.map((p) => p.name)).not.toContain("Zoom In");
  });

  it("assemble returns music tracks and no presets", async () => {
    const { body } = await getCatalog("assemble");
    expect(body.models.map((m) => m.name)).toEqual(["Ghép video"]);
    expect(body.presets).toEqual([]);
    expect(body.music?.length).toBeGreaterThan(0);
    expect(body.music?.[0]).toHaveProperty("file");
  });

  it("story kind: video models, style+camera presets with theme fields, story skills, plan cost", async () => {
    const res = await GET(new Request("http://localhost/api/catalog?kind=story"));
    const body = (await res.json()) as CatalogBody & {
      skills: { kind: string; locked: boolean; slug: string }[];
      presets: { kind: string; palette: string[]; cover: string }[];
      story: { planCost: number; maxShots: number };
      videoUnavailable: boolean;
    };
    expect(body.models.every((m) => m.kind === "VIDEO")).toBe(true);
    expect(new Set(body.presets.map((p) => p.kind))).toEqual(new Set(["STYLE", "CAMERA"]));
    expect(body.presets.every((p) => p.palette.length > 0 && p.cover)).toBe(true);
    expect(body.skills.some((s) => s.kind === "STORY")).toBe(true);
    expect(body.skills[0]).not.toHaveProperty("instructions");
    expect(body.story).toEqual({ planCost: 0.5, maxShots: 8 });
    expect(body.videoUnavailable).toBe(false);
  });

  it("rejects bad kind and anonymous user", async () => {
    expect((await getCatalog("audio")).status).toBe(400);
    current.user = null;
    expect((await getCatalog("image")).status).toBe(401);
  });
});
