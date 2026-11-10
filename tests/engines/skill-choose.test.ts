import { describe, expect, it, vi } from "vitest";
import type { PromptSkill } from "@prisma/client";
import { quotaCooldownSec } from "@/server/ai/gateway";
import { guardPrompt } from "@/server/ai/guard";
import { CANDIDATES, chooseSkillByRules, parseRouterAnswer, rankSkills, routeSkill } from "@/server/ai/router";
import { SKILLS } from "../../prisma/seed-data";
import { SKILL_LIBRARY, SKILL_META } from "../../prisma/skill-library";

const ALL = [...SKILLS.map((s) => ({ ...s, ...SKILL_META[s.slug] })), ...SKILL_LIBRARY].map((s, i) => ({
  ...s,
  id: `sk${i}`,
  enabled: true,
  minPlanRank: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
})) as unknown as PromptSkill[];
const image = ALL.filter((s) => s.kind === "IMAGE");
const video = ALL.filter((s) => s.kind === "VIDEO");

describe("thư viện skill", () => {
  it("đủ ~60 skill, slug không trùng, skill nào cũng có lĩnh vực + từ khóa", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(55);
    expect(new Set(ALL.map((s) => s.slug)).size).toBe(ALL.length);
    for (const s of ALL) {
      expect(s.category, s.slug).toBeTruthy();
      expect(s.tags.length, s.slug).toBeGreaterThan(0);
      expect(s.instructions, s.slug).toMatch(/JSON/);
    }
  });
});

describe("bộ chọn skill tầng 1 (luật)", () => {
  const pick = (list: PromptSkill[], idea: string) => chooseSkillByRules(list, idea)?.slug;
  it("chọn đúng lĩnh vực theo ý tưởng tiếng Việt", () => {
    expect(pick(image, "Ly cà phê sữa đá trên bàn gỗ quán vỉa hè")).toBe("image-food-drink");
    expect(pick(image, "bánh mì thịt nóng giòn trên giấy gói, xe bánh mì vỉa hè")).toBe("image-food-drink");
    expect(pick(image, "Vịnh Hạ Long lúc bình minh, sương mù")).toBe("image-vietnam-landscape");
    expect(pick(image, "ảnh nền trắng đăng shopee cho bình giữ nhiệt")).toBe("image-ecommerce-white");
    expect(pick(image, "nồi chiên không dầu trong căn bếp nhà phố")).toBe("image-home-appliance");
    expect(pick(video, "video đập hộp unbox tai nghe mới, review chân thật")).toBe("video-review-unbox");
    expect(pick(video, "flycam ruộng bậc thang Sapa mùa lúa chín")).toBe("video-travel-scenic");
    expect(pick(video, "vlog một ngày của tôi, buổi sáng pha cà phê")).toBe("video-vlog-daily");
  });
  it("video có khung đầu → làm ảnh chuyển động", () => {
    expect(chooseSkillByRules(video, "bát phở bốc khói", { hasRef: true, kind: "video" })?.slug).toBe("video-animate-still");
  });
  it("lấy đúng ~10 ứng viên có điểm cao nhất", () => {
    const ranked = rankSkills(image, "review sản phẩm tai nghe công nghệ, ảnh cầm tay");
    expect(ranked.slice(0, CANDIDATES).map((r) => r.skill.slug)).toEqual(expect.arrayContaining(["image-review-ugc-hand", "image-tech-gadget"]));
  });
});

describe("routeSkill 2 tầng", () => {
  it("thắng áp đảo thì không gọi AI", async () => {
    const agy = vi.fn();
    const r = await routeSkill({ kind: "image", idea: "ảnh nền trắng đăng shopee lazada tiktok shop cho bình giữ nhiệt" }, { skills: image, runners: { agy } });
    expect(r.route.method).toBe("rule");
    expect(r.skill?.slug).toBe("image-ecommerce-white");
    expect(agy).not.toHaveBeenCalled();
  });

  it("chưa rõ thì AI chọn trong ≤10 ứng viên", async () => {
    const seen: string[] = [];
    const agy = vi.fn(async ({ prompt }: { prompt: string }) => {
      seen.push(prompt);
      return '{"slug": "image-review-ugc-hand", "reason": "người dùng cầm tay review"}';
    });
    const r = await routeSkill(
      { kind: "image", idea: "review tai nghe mới mua, ảnh cầm tay" },
      { skills: image, runners: { agy }, setting: { order: ["agy"], timeoutSec: 30 } as never },
    );
    expect(r.route.method).toBe("ai");
    expect(r.skill?.slug).toBe("image-review-ugc-hand");
    expect(r.route.candidates.length).toBeLessThanOrEqual(CANDIDATES);
    expect(seen[0].match(/^\d+\. /gm)?.length).toBeLessThanOrEqual(CANDIDATES);
  });

  it("AI trả bậy thì quay về tầng 1", async () => {
    const r = await routeSkill(
      { kind: "image", idea: "review tai nghe mới mua, ảnh cầm tay" },
      { skills: image, runners: { agy: async () => "không biết" }, setting: { order: ["agy"], timeoutSec: 30 } as never },
    );
    expect(r.route.method).toBe("fallback");
    expect(r.skill).toBeTruthy();
  });

  it("đọc được câu trả lời AI có chữ thừa / thiếu JSON", () => {
    const c = image.slice(0, 3);
    expect(parseRouterAnswer(`Chọn: {"slug":"${c[1].slug}"}`, c).slug).toBe(c[1].slug);
    expect(parseRouterAnswer(`best is ${c[2].slug}`, c).slug).toBe(c[2].slug);
    expect(() => parseRouterAnswer("xyz", c)).toThrow();
  });
});

describe("guardPrompt (kiểm prompt trước khi gửi engine)", () => {
  it("bỏ chữ tỷ lệ, zoom giật, yêu cầu chữ trên hình; giữ nội dung", () => {
    const g = guardPrompt(
      "video",
      'Prompt: "A bowl of pho steams on a table, vertical 9:16 framing. The camera zooms in and out while text overlay saying "SALE 50%" appears, 4K."',
    );
    expect(g.prompt).not.toMatch(/9:16|zooms in and out|SALE|4K|Prompt:/);
    expect(g.prompt).toMatch(/bowl of pho/);
    expect(g.prompt).toMatch(/one slow smooth dolly in/);
    expect(g.fixes.length).toBeGreaterThanOrEqual(3);
  });
  it("prompt sạch thì không sửa", () => {
    const clean = "A ceramic mug of iced coffee on a wooden table, soft window light, shallow depth of field.";
    expect(guardPrompt("image", clean)).toEqual({ prompt: clean, fixes: [] });
  });
});

describe("quotaCooldownSec (gateway bỏ qua provider hết quota)", () => {
  it("đọc thời gian reset", () => {
    // Tối đa 30 phút: quota agy tính theo model / tài khoản, thường dùng lại được sớm hơn giờ reset.
    expect(quotaCooldownSec("error: Individual quota reached. Resets in 2h34m33s.")).toBe(1800);
    expect(quotaCooldownSec("rate limit, resets in 5m")).toBe(300);
    expect(quotaCooldownSec("You have exhausted your capacity on this model.")).toBe(900);
    expect(quotaCooldownSec("agy thoát mã 1: timeout")).toBeNull();
  });
});
