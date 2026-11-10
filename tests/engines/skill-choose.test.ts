import { describe, expect, it } from "vitest";
import { quotaCooldownSec } from "@/server/ai/gateway";
import { chooseSkill } from "@/server/engines/prompt-writer";
import { SKILLS } from "../../prisma/seed-data";

const image = SKILLS.filter((s) => s.kind === "IMAGE");
const video = SKILLS.filter((s) => s.kind === "VIDEO");

describe("chooseSkill (AI Gateway tự chọn skill)", () => {
  it("chọn theo nội dung ý tưởng tiếng Việt có dấu", () => {
    expect(chooseSkill(image, "Ly cà phê sữa đá trên bàn gỗ")?.slug).toBe("image-food-drink");
    expect(chooseSkill(image, "Vịnh Hạ Long lúc bình minh, sương mù")?.slug).toBe("image-vietnam-landscape");
    expect(chooseSkill(image, "cô gái mặc áo dài trắng, chân dung")?.slug).toBe("image-portrait-fashion");
    expect(chooseSkill(image, "chai nước hoa hổ phách, ảnh quảng cáo sản phẩm")?.slug).toBe("image-product-hero");
    expect(chooseSkill(video, "bát phở bốc khói")?.slug).toBe("video-food-motion");
    expect(chooseSkill(video, "flycam ruộng bậc thang Sapa")?.slug).toBe("video-travel-scenic");
    // "giấy gói" không được nhầm thành "giày" (sản phẩm)
    expect(chooseSkill(image, "bánh mì thịt nóng giòn trên giấy gói, xe bánh mì vỉa hè buổi sáng")?.slug).toBe("image-food-drink");
    expect(chooseSkill(image, "đôi giày thể thao trắng trên nền cát")?.slug).toBe("image-product-hero");
  });

  it("không khớp gì thì lấy skill đầu theo sort", () => {
    expect(chooseSkill(image, "xyz")?.slug).toBe("image-product-hero");
    expect(chooseSkill(video, "xyz")?.slug).toBe("video-one-move");
  });

  it("video có ảnh khung đầu thì ưu tiên làm ảnh chuyển động", () => {
    expect(chooseSkill(video, "bát phở bốc khói", { hasRef: true, kind: "video" })?.slug).toBe("video-animate-still");
  });
});

describe("quotaCooldownSec (gateway bỏ qua provider hết quota)", () => {
  it("đọc thời gian reset", () => {
    expect(quotaCooldownSec("error: Individual quota reached. Resets in 2h34m33s.")).toBe(2 * 3600 + 34 * 60 + 33);
    expect(quotaCooldownSec("You have exhausted your capacity on this model.")).toBe(900);
    expect(quotaCooldownSec("agy thoát mã 1: timeout")).toBeNull();
  });
});
