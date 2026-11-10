#!/usr/bin/env node
// `codex app-server` giả cho test: JSON-RPC qua stdin/stdout (không có trường jsonrpc, giống codex thật).
// Prompt: [[error]] turn lỗi, [[crash]] thoát giữa lượt, [[sleep:N]] chờ N ms (interrupt được), [[approval]] hỏi duyệt lệnh
// trước khi trả lời, [[deltaonly]] chỉ gửi delta; còn lại: delta "cx:" + item/completed (final_answer) "cx:<model>:<effort>:<số ký tự>".
// FAKE_CX_LOG: ghi "start <CODEX_HOME>" và các method nhận được. FAKE_CX_NO_RATE=1: account/rateLimits/read lỗi.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const log = (s) => process.env.FAKE_CX_LOG && appendFileSync(process.env.FAKE_CX_LOG, s + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const threads = new Map();
const pending = new Map();
let n = 0;
let reqId = 1000;

log(`start ${process.env.CODEX_HOME ?? ""}`);
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = ++reqId;
    pending.set(id, resolve);
    send({ id, method, params });
  });

createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined) {
    pending.get(m.id)?.(m.result ?? m.error);
    pending.delete(m.id);
    return;
  }
  log(m.method);
  const p = m.params ?? {};
  const reply = (result) => send({ id: m.id, result });
  switch (m.method) {
    case "initialize":
      return reply({ userAgent: "fake/0.1", codexHome: process.env.CODEX_HOME ?? "", platformFamily: "unix", platformOs: "linux" });
    case "initialized":
      return;
    case "thread/start": {
      const id = `th-${++n}`;
      threads.set(id, { model: p.model ?? "gpt-default", interrupted: false });
      log(`thread model=${p.model ?? ""} sandbox=${p.sandbox} approval=${p.approvalPolicy} ephemeral=${p.ephemeral}`);
      return reply({ thread: { id }, model: p.model ?? "gpt-default" });
    }
    case "thread/unsubscribe":
      threads.delete(p.threadId);
      return reply({ status: "unsubscribed" });
    case "turn/interrupt": {
      const t = threads.get(p.threadId);
      if (t) t.interrupted = true;
      return reply({});
    }
    case "account/rateLimits/read":
      if (process.env.FAKE_CX_NO_RATE) return send({ id: m.id, error: { code: -32000, message: "not logged in" } });
      return reply({
        rateLimits: { limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1794313806 }, secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1794449450 }, planType: "plus" },
        rateLimitsByLimitId: null,
      });
    case "turn/start": {
      const threadId = p.threadId;
      const t = threads.get(threadId);
      const turnId = `tu-${n}`;
      const text = p.input?.[0]?.text ?? "";
      log(`turn effort=${p.effort ?? ""}`);
      reply({ turn: { id: turnId, status: "inProgress", items: [] } });
      const done = (status, items, error = null) => send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status, items, error } } });
      if (text.includes("[[crash]]")) process.exit(3);
      if (text.includes("[[error]]")) {
        send({ method: "error", params: { threadId, turnId, willRetry: false, error: { message: "You've hit your usage limit" } } });
        return done("failed", [], { message: "You've hit your usage limit" });
      }
      const sl = /\[\[sleep:(\d+)\]\]/.exec(text);
      if (sl) {
        const until = Date.now() + Number(sl[1]);
        while (Date.now() < until && !t.interrupted) await sleep(10);
        if (t.interrupted) return done("interrupted", []);
      }
      let extra = "";
      if (text.includes("[[approval]]")) {
        const r = await ask("item/commandExecution/requestApproval", { threadId, turnId, itemId: "cmd1", command: "rm -rf /" });
        extra = `:${r?.decision ?? "none"}`;
      }
      const answer = `cx:${t.model}:${p.effort ?? ""}:${text.length}${extra}`;
      send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: answer.slice(0, 3) } });
      send({ method: "item/agentMessage/delta", params: { threadId, turnId, itemId: "m1", delta: answer.slice(3) } });
      if (text.includes("[[deltaonly]]")) return done("completed", []);
      const item = { type: "agentMessage", id: "m1", text: answer, phase: "final_answer" };
      send({ method: "item/completed", params: { threadId, turnId, item } });
      return done("completed", [item]);
    }
    default:
      return send({ id: m.id, error: { code: -32601, message: `unknown ${m.method}` } });
  }
});
