import { describe, expect, it } from "vitest";
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
  });

  it("không khớp gì thì lấy skill đầu theo sort", () => {
    expect(chooseSkill(image, "xyz")?.slug).toBe("image-product-hero");
    expect(chooseSkill(video, "xyz")?.slug).toBe("video-one-move");
  });

  it("video có ảnh khung đầu thì ưu tiên làm ảnh chuyển động", () => {
    expect(chooseSkill(video, "bát phở bốc khói", { hasRef: true, kind: "video" })?.slug).toBe("video-animate-still");
  });
});
