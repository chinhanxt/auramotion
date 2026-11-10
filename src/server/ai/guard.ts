// Kiểm prompt AI viết trước khi gửi engine: sửa tự động các lỗi hay gặp (luật Muse), ghi lại đã sửa gì.

export type GuardResult = { prompt: string; fixes: string[] };

const MAX_LEN = 1200;

const FORMAT_WORDS =
  /\s*(?:,\s*)?\b(?:(?:in\s+)?(?:a\s+)?(?:vertical|horizontal|portrait|landscape|square)\s+(?:9:16|16:9|1:1|4:5|format|orientation|frame|framing|aspect(?:\s+ratio)?)|(?:aspect\s+ratio|ratio)\s*(?:of\s*)?\d{1,2}\s*:\s*\d{1,2}|\d{1,2}\s*:\s*\d{1,2}\s*(?:aspect(?:\s+ratio)?|format|frame|framing|ratio)|--ar\s*\d+:\d+|\b(?:4k|8k|1080p|720p|uhd)\b(?:\s+(?:resolution|quality))?)\b\.?/gi;
const ZOOM_PULSE = /\b(?:zoom(?:s|ing)?\s+in\s+and\s+(?:back\s+)?out|zoom(?:s|ing)?\s+out\s+and\s+(?:back\s+)?in|pulsing\s+zoom|repeated\s+zoom(?:s)?|crash\s+zoom|rapid\s+zoom(?:s)?|whip\s+pan(?:s)?|shaky\s+cam(?:era)?)\b/gi;
const TEXT_REQ = /\b(?:with\s+)?(?:the\s+)?(?:text|caption|title|words?|logo|watermark)\s+(?:overlay\s+)?(?:saying|that\s+says|reading|reads)\s+["“][^"”]{1,80}["”]/gi;

export function guardPrompt(kind: "image" | "video", raw: string, opts: { allowText?: boolean } = {}): GuardResult {
  const fixes: string[] = [];
  let p = raw.trim();

  // Bỏ vỏ markdown / nhãn "Prompt:" / ngoặc kép bao ngoài.
  const unwrapped = p
    .replace(/^```[a-z]*\s*|\s*```$/gi, "")
    .replace(/^\s*(?:prompt|image prompt|video prompt)\s*:\s*/i, "")
    .replace(/^["“]([\s\S]*)["”]$/, "$1")
    .trim();
  if (unwrapped !== p) {
    p = unwrapped;
    fixes.push("bỏ vỏ markdown/nhãn");
  }

  const noFormat = p.replace(FORMAT_WORDS, "");
  if (noFormat !== p) {
    p = noFormat;
    fixes.push("bỏ chữ tỷ lệ/độ phân giải (engine đã nhận tỷ lệ riêng)");
  }

  if (kind === "video") {
    const noPulse = p.replace(ZOOM_PULSE, "one slow smooth dolly in");
    if (noPulse !== p) {
      p = noPulse;
      fixes.push("thay zoom giật / máy rung bằng 1 chuyển động mượt");
    }
  }

  if (!opts.allowText) {
    const noText = p.replace(TEXT_REQ, "");
    if (noText !== p) {
      p = noText;
      fixes.push("bỏ yêu cầu chữ/logo trên hình");
    }
  }

  const tidy = p
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;])\1+/g, "$1")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (tidy !== p) p = tidy;

  if (p.length > MAX_LEN) {
    const cut = p.slice(0, MAX_LEN);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("."));
    p = end > MAX_LEN * 0.6 ? cut.slice(0, end + 1) : cut;
    fixes.push(`rút gọn còn ${p.length} ký tự`);
  }
  return { prompt: p, fixes };
}
