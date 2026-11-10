import { shortModelLabel } from "./model-names";

// Nhãn hiển thị cho provider AI (dùng chung server + client). Id nội bộ (agy / codex / muse) giữ nguyên,
// giao diện chỉ hiện hãng: agy → Google, codex → OpenAI, muse → Muse.

export type ProviderKey = "agy" | "codex" | "muse" | "local";

const NAME: Record<ProviderKey, string> = { agy: "Google", codex: "OpenAI", muse: "Muse", local: "Máy chủ" };
const VENDOR: Record<ProviderKey, string> = { agy: "google", codex: "openai", muse: "muse", local: "local" };
// Tên hãng khi nói "ai viết": model Claude chạy qua agy vẫn là "Claude viết".
const VENDOR_NAME: Record<string, string> = { google: "Google", anthropic: "Claude", openai: "OpenAI", muse: "Muse", local: "Máy chủ" };

// "agy" | "AGY" | "antigravity" → "agy"; "codex" | "CODEX" | "openai" → "codex"; còn lại null.
export function providerKey(p: string | null | undefined): ProviderKey | null {
  const k = (p ?? "").trim().toLowerCase();
  if (k === "agy" || k === "antigravity" || k === "google") return "agy";
  if (k === "codex" || k === "openai") return "codex";
  if (k.startsWith("muse")) return "muse";
  if (k === "local") return "local";
  return null;
}

// Nhãn provider: Google / OpenAI / Muse (`chat`: "Muse chat" cho vai AI viết); không rõ thì trả nguyên văn.
export function providerLabel(p: string | null | undefined, opts?: { chat?: boolean }): string {
  const k = providerKey(p);
  if (!k) return (p ?? "").trim();
  if (k === "muse" && opts?.chat) return "Muse chat";
  return NAME[k];
}

// Hãng theo id model: gemini → google, claude → anthropic, gpt / o3 / codex → openai, muse → muse.
export function vendorOfModel(model: string | null | undefined): string | null {
  const id = (model ?? "").trim().toLowerCase();
  if (!id) return null;
  if (/^(gemini|imagen|veo)/.test(id)) return "google";
  if (/^claude|opus|sonnet|haiku/.test(id)) return "anthropic";
  if (/^(gpt|codex|o\d|dall-e)/.test(id)) return "openai";
  if (id.startsWith("muse")) return "muse";
  return null;
}

// Hãng để vẽ logo: theo model nếu biết, không thì theo provider.
export function providerVendor(p: string | null | undefined, model?: string | null): string {
  const byModel = vendorOfModel(model);
  if (byModel) return byModel;
  const k = providerKey(p);
  return k ? VENDOR[k] : (p ?? "").trim().toLowerCase() || "other";
}

// "Google" / "Claude" / "OpenAI" / "Muse" cho câu "<hãng> viết".
export function vendorWriterName(vendor: string): string {
  return VENDOR_NAME[vendor] ?? (vendor ? vendor.charAt(0).toUpperCase() + vendor.slice(1) : "AI");
}

// "Google · Flash 3.8 · Nhanh" (provider + tên model ngắn); tên model đã bắt đầu bằng hãng thì bỏ trùng ("Muse Image").
export function aiLabel(provider: string | null | undefined, model?: string | null, known?: readonly string[]): string {
  const p = providerLabel(provider);
  const m = model ? shortModelLabel(model, known) : "";
  if (!m) return p;
  if (!p || m.toLowerCase().startsWith(p.toLowerCase())) return m;
  return `${p} · ${m}`;
}
