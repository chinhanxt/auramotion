import { describe, expect, it } from "vitest";
import { effortBadge, effortOf, shortModelLabel, shortModelName } from "@/lib/model-names";
import { aiLabel, providerLabel, providerVendor, vendorWriterName } from "@/lib/providers";

describe("shortModelName", () => {
  it("bỏ tiền tố hãng, giữ dòng + phiên bản; bỏ phiên bản khi dòng chỉ có 1 bản", () => {
    const cases: [string, string][] = [
      ["gpt-6-astra", "Astra"],
      ["gpt-6.1-sol", "Sol 6.1"],
      ["gpt-6-sol", "Sol 6"],
      ["gpt-5.6-sol", "Sol 5.6"],
      ["gpt-6.1-terra", "Terra 6.1"],
      ["gpt-5.6-terra", "Terra 5.6"],
      ["gpt-6-luna", "Luna 6"],
      ["gpt-5.6-luna", "Luna 5.6"],
      ["gpt-5.5", "GPT 5.5"],
      ["gpt-6-chat-thinking", "Chat Thinking"],
      ["gpt-daybreak-blue-latest", "Daybreak Blue"],
      ["gemini-3.8-flash-low", "Flash 3.8"],
      ["gemini-3.8-flash-medium", "Flash 3.8"],
      ["gemini-3.8-flash-high", "Flash 3.8"],
      ["gemini-3.8-pro", "Pro 3.8"],
      ["gemini-4-argon-low", "Argon"],
      ["gemini-4-argon-high", "Argon"],
      ["claude-sonnet-5-5-low", "Sonnet"],
      ["claude-opus-5-5-medium", "Opus"],
      ["gpt-oss-120b-medium", "GPT OSS 120B"],
      ["muse-image", "Muse Image"],
      ["muse-video", "Muse Video"],
    ];
    for (const [id, name] of cases) expect(shortModelName(id), id).toBe(name);
  });

  it("thêm phiên bản khi danh sách thật có dòng cùng tên khác phiên bản", () => {
    expect(shortModelName("claude-opus-5-5-low", ["claude-opus-5-5-low", "claude-opus-6-low"])).toBe("Opus 5.5");
    expect(shortModelName("gpt-6-astra", ["gpt-6-astra", "gpt-6.1-astra"])).toBe("Astra 6");
    // Dòng hạng chung (Flash / Pro) luôn giữ phiên bản, kể cả khi chỉ có 1 bản.
    expect(shortModelName("gemini-3.8-flash-low", ["gemini-3.8-flash-low"])).toBe("Flash 3.8");
    // Danh sách rỗng: không có bản nào khác → bỏ phiên bản.
    expect(shortModelName("gpt-6-luna", [])).toBe("Luna");
  });

  it("chịu được id lạ / rỗng / có effort kèm chữ", () => {
    expect(shortModelName("")).toBe("");
    expect(shortModelName(null)).toBe("");
    expect(shortModelName("assemble")).toBe("Assemble");
    expect(shortModelName("gpt-6-luna · low")).toBe("Luna 6");
    expect(shortModelLabel("gemini-3.8-flash-low")).toBe("Flash 3.8 · Nhanh");
    expect(shortModelLabel("gpt-6.1-sol")).toBe("Sol 6.1");
  });

  it("effort", () => {
    expect(effortOf("gemini-3.8-flash-medium")).toBe("medium");
    expect(effortOf("gpt-6.1-sol")).toBeNull();
    expect(effortBadge("claude-opus-5-5-high")).toBe("Kỹ");
  });
});

describe("providerLabel", () => {
  it("chỉ hiện hãng, không hiện id nội bộ", () => {
    expect(providerLabel("agy")).toBe("Google");
    expect(providerLabel("AGY")).toBe("Google");
    expect(providerLabel("codex")).toBe("OpenAI");
    expect(providerLabel("CODEX")).toBe("OpenAI");
    expect(providerLabel("muse")).toBe("Muse");
    expect(providerLabel("muse", { chat: true })).toBe("Muse chat");
    expect(providerLabel("local")).toBe("Máy chủ");
  });

  it("hãng logo theo model, nhãn viết", () => {
    expect(providerVendor("agy", "claude-sonnet-5-5-low")).toBe("anthropic");
    expect(providerVendor("agy", "gemini-3.8-flash-low")).toBe("google");
    expect(providerVendor("agy")).toBe("google");
    expect(providerVendor("codex")).toBe("openai");
    expect(providerVendor("muse")).toBe("muse");
    expect(vendorWriterName("anthropic")).toBe("Claude");
    expect(vendorWriterName("google")).toBe("Google");
    expect(aiLabel("agy", "gemini-3.8-flash-low")).toBe("Google · Flash 3.8 · Nhanh");
    expect(aiLabel("muse", "muse-image")).toBe("Muse Image");
    expect(aiLabel("codex")).toBe("OpenAI");
  });
});
