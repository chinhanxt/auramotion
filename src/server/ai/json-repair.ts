// Sửa JSON AI trả hỏng (Muse chat hay: thiếu "[" sau "shots":, cụt đuôi, kèm chữ thừa).

function stripFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").replace(/[“”]/g, '"');
}

// Đóng các ngoặc còn mở (bỏ qua ngoặc trong chuỗi); cắt chuỗi đang dở.
export function balanceBrackets(text: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let out = "";
  for (const ch of text) {
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      // Ngoặc đóng lệch: đóng hết các ngoặc trong cho tới ngoặc khớp.
      const at = stack.lastIndexOf(ch);
      if (at === -1) continue;
      while (stack.length > at + 1) out += stack.pop();
      stack.pop();
    }
    out += ch;
  }
  if (inStr) out += '"';
  out = out.replace(/,\s*$/, "");
  while (stack.length) out += stack.pop();
  return out;
}

function noTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Mọi đối tượng {...} cân ngoặc bắt đầu tại vị trí `from`.
function objectAt(text: string, from: number): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(from, i + 1);
    }
  }
  return null;
}

// Phương án cuối: nhặt từng đối tượng cảnh {"title"... / {"prompt"...} còn nguyên.
export function scanShotObjects(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const re = /\{\s*"(title|prompt|camera|description)"\s*:/g;
  let m: RegExpExecArray | null;
  let after = -1;
  while ((m = re.exec(text))) {
    if (m.index < after) continue;
    const obj = objectAt(text, m.index);
    if (!obj) continue;
    const data = tryParse(noTrailingCommas(obj));
    if (data && typeof data === "object" && !Array.isArray(data) && ("prompt" in data || "description" in data)) {
      const rec = data as Record<string, unknown>;
      if (!Array.isArray(rec.shots)) {
        out.push(rec);
        after = m.index + obj.length;
      }
    }
  }
  return out;
}

// Kịch bản story: {"title", "shots": [...]} — sửa các lỗi hay gặp, trả undefined nếu bó tay.
export function repairStoryJson(raw: string): { title?: unknown; shots: unknown[] } | undefined {
  const text = stripFences(raw);
  const start = text.indexOf("{");
  if (start !== -1) {
    let body = text.slice(start);
    const end = body.lastIndexOf("}");
    const candidates = [end !== -1 ? body.slice(0, end + 1) : body];
    // "shots": { ... }, { ... } → "shots": [ { ... }, { ... } ]
    body = body.replace(/("(?:shots|scenes)"\s*:\s*)\{/, "$1[{");
    candidates.push(body, end !== -1 ? body.slice(0, body.lastIndexOf("}") + 1) : body);
    for (const c of candidates) {
      for (const fixed of [c, noTrailingCommas(c), noTrailingCommas(balanceBrackets(c)), noTrailingCommas(balanceBrackets(c.replace(/\][^\]]*$/, "")))]) {
        const data = tryParse(fixed) as { title?: unknown; shots?: unknown; scenes?: unknown } | undefined;
        if (data && typeof data === "object") {
          const shots = Array.isArray(data.shots) ? data.shots : Array.isArray(data.scenes) ? data.scenes : null;
          if (shots && shots.length) return { title: data.title, shots };
        }
      }
    }
  }
  const shots = scanShotObjects(text);
  if (shots.length === 0) return undefined;
  const title = /^[^[]*?"title"\s*:\s*"([^"]*)"\s*,\s*"(?:shots|scenes)"/.exec(text)?.[1];
  return { title, shots };
}
