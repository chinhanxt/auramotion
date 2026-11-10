#!/usr/bin/env node
// Agent ACP giả cho test: nói JSON-RPC qua stdin/stdout giống `agy acp`.
// FAKE_MODELS: id model (phẩy). Nội dung prompt: [[sleep:N]] chờ N ms (hủy được), [[quota]] trả lỗi hết quota,
// [[crash]] thoát; còn lại trả {"prompt":"acp:<model>:<số ký tự>"}. FAKE_ACP_LOG: ghi các method nhận được.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const MODELS = (process.env.FAKE_MODELS ?? "gemini-3.8-flash-low,claude-sonnet-5-5-low").split(",").map((id) => ({ modelId: id, name: id }));
const sessions = new Map();
let n = 0;
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => process.env.FAKE_ACP_LOG && appendFileSync(process.env.FAKE_ACP_LOG, s + "\n");

log(`start args=${process.argv.slice(2).join(" ")} cloud=${process.env.CLOUD_CODE_URL ?? ""}`);
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) return;
  const p = m.params ?? {};
  log(m.method + (p.modelId ? ` ${p.modelId}` : ""));
  const reply = (result) => send({ id: m.id, result });
  const fail = (code, message) => send({ id: m.id, error: { code, message } });
  switch (m.method) {
    case "initialize":
      return reply({ protocolVersion: 1 });
    case "session/new": {
      const id = "s" + ++n;
      sessions.set(id, { model: MODELS[0].modelId, cancelled: false });
      return reply({ sessionId: id, models: { availableModels: MODELS, currentModelId: MODELS[0].modelId } });
    }
    case "session/set_model": {
      const s = sessions.get(p.sessionId);
      if (!s) return fail(-32602, "Unknown session");
      if (!MODELS.some((x) => x.modelId === p.modelId)) return fail(-32602, `Unknown model ID: ${p.modelId}`);
      s.model = p.modelId;
      return reply({});
    }
    case "session/close":
      sessions.delete(p.sessionId);
      return reply({});
    case "session/cancel": {
      const s = sessions.get(p.sessionId);
      if (s) s.cancelled = true;
      return;
    }
    case "session/prompt":
      return void prompt(m.id, p);
    default:
      return fail(-32601, "Method not found");
  }
});

async function prompt(id, p) {
  const s = sessions.get(p.sessionId);
  if (!s) return send({ id, error: { code: -32602, message: "Unknown session" } });
  s.cancelled = false;
  const text = p.prompt.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const sl = /\[\[sleep:(\d+)\]\]/.exec(text);
  if (sl) for (let t = 0; t < Number(sl[1]) && !s.cancelled; t += 10) await sleep(10);
  if (s.cancelled) return send({ id, result: { stopReason: "cancelled" } });
  if (text.includes("[[crash]]")) process.exit(3);
  if (text.includes("[[quota]]")) return send({ id, error: { code: -32000, message: "You have exhausted your capacity on this model. Resets in 1h2m3s" } });
  const out = JSON.stringify({ prompt: `acp:${s.model}:${text.length}` });
  for (const part of [out.slice(0, 5), out.slice(5)]) {
    send({ method: "session/update", params: { sessionId: p.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part } } } });
    await sleep(2);
  }
  send({ id, result: { stopReason: "end_turn", usage: { inputTokens: text.length, outputTokens: 10 } } });
}
