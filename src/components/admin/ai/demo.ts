// Dữ liệu mẫu cho `/admin/ai?demo=1` (trình bày / chụp màn hình khi backend chưa có). Số đo theo docs/v2-ai-runtime.md.
import type { AiData, TestResult } from "./types";

const H = 3600_000;

export function demoAi(now = Date.now()): AiData {
  return {
    roles: {
      writer: {
        chain: [{ provider: "agy", model: "gemini-3.8-flash-low" }, { provider: "codex", model: "gpt-6-luna", effort: "low" }, { provider: "muse" }],
        strategy: "fallback",
        timeoutSec: 60,
      },
      story: { chain: [{ provider: "muse" }, { provider: "agy", model: "claude-sonnet-5-5-low" }] },
      prewrite: true,
      cacheHours: 72,
      agy: { transport: "acp", proxy: true },
      codex: { profile: "default" },
    },
    providers: {
      agy: {
        installed: true,
        version: "1.14.2",
        transport: "acp",
        acp: { alive: true, processes: 1, sessions: 2 },
        proxy: { enabled: true, port: 8901, running: true },
        accounts: [
          {
            id: "a1",
            email: "studio.xt@gmail.com",
            active: true,
            quota: [
              { group: "Gemini Flash", pct: 72, resetAt: now + 2.4 * H },
              { group: "Gemini Pro", pct: 38, resetAt: now + 4.1 * H },
              { group: "Claude", pct: 12, resetAt: now + 0.6 * H },
            ],
            groups: {
              gemini: { fiveHour: { pct: 72, resetAt: now + 2.4 * H }, weekly: { pct: 58, resetAt: now + 3.2 * 24 * H } },
              claude: { fiveHour: { pct: 12, resetAt: now + 0.6 * H }, weekly: { pct: 41, resetAt: now + 3.2 * 24 * H } },
            },
          },
          {
            id: "a2",
            email: "muse.helper02@gmail.com",
            active: false,
            quota: [
              { group: "Gemini Flash", pct: 100, resetAt: null },
              { group: "Gemini Pro", pct: 91, resetAt: now + 5 * H },
              { group: "Claude", pct: 64, resetAt: now + 3 * H },
            ],
            groups: {
              gemini: { fiveHour: { pct: 100, resetAt: null }, weekly: { pct: 88, resetAt: now + 5.5 * 24 * H } },
              claude: { fiveHour: { pct: 64, resetAt: now + 3 * H }, weekly: { pct: 79, resetAt: now + 5.5 * 24 * H } },
            },
          },
        ],
        models: [
          { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (low)" },
          { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (medium)" },
          { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (high)" },
          { id: "gemini-3.8-pro-low", name: "Gemini 3.8 Pro (low)" },
          { id: "gemini-3.8-pro-high", name: "Gemini 3.8 Pro (high)" },
          { id: "claude-sonnet-5-5-low", name: "Claude Sonnet 5.5 (low)" },
          { id: "claude-sonnet-5-5-medium", name: "Claude Sonnet 5.5 (medium)" },
          { id: "claude-sonnet-5-5-high", name: "Claude Sonnet 5.5 (high)" },
          { id: "claude-opus-5-5-low", name: "Claude Opus 5.5 (low)" },
          { id: "claude-opus-5-5-medium", name: "Claude Opus 5.5 (medium)" },
          { id: "claude-opus-5-5-high", name: "Claude Opus 5.5 (high)" },
        ],
      },
      codex: {
        installed: true,
        version: "0.98.0",
        profiles: [
          { name: "default", loggedIn: true, method: "ChatGPT", active: true, quota: { primary: { usedPercent: 34, windowMinutes: 300, resetsAt: Math.round((now + 2.1 * H) / 1000) }, secondary: { usedPercent: 61, windowMinutes: 10080, resetsAt: Math.round((now + 70 * H) / 1000) }, source: "app-server", checkedAt: now - 1 * 60_000 } },
          { name: "acc2", loggedIn: true, method: "ChatGPT", active: false, quota: { primary: { usedPercent: 88, windowMinutes: 300, resetsAt: Math.round((now + 0.7 * H) / 1000) }, secondary: { usedPercent: 93, windowMinutes: 10080, resetsAt: Math.round((now + 30 * H) / 1000) }, source: "app-server", checkedAt: now - 4 * 60_000 } },
          { name: "acc 3", loggedIn: true, method: "API key", active: false, quota: { primary: { usedPercent: 5, windowMinutes: 300, resetsAt: Math.round((now + 4.6 * H) / 1000) }, secondary: { usedPercent: 22, windowMinutes: 10080, resetsAt: Math.round((now + 120 * H) / 1000) }, source: "session-log", checkedAt: now - 38 * 60_000 } },
          { name: "acc 4", loggedIn: false, method: null, active: false },
          { name: "acc 5", loggedIn: true, method: "ChatGPT", active: false },
          { name: "acc 6", loggedIn: true, method: "ChatGPT", active: false },
          { name: "acc 7", loggedIn: false, method: null, active: false },
          { name: "team", loggedIn: true, method: "ChatGPT", active: false },
        ],
        models: [
          { id: "gpt-6-luna", name: "GPT-6 Luna", efforts: ["minimal", "low", "medium", "high"], defaultEffort: "low", profiles: ["default", "acc2", "acc 3", "acc 5", "acc 6", "team"] },
          { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", profiles: ["default", "acc2", "acc 6", "team"] },
          { id: "gpt-6.1-sol-mini", name: "GPT-6.1 Sol mini", efforts: ["low", "medium"], defaultEffort: "low", profiles: ["acc 3", "acc 5"] },
          { id: "gpt-6-codex-preview", name: "GPT-6 Codex preview", efforts: ["low", "high"], defaultEffort: "low", profiles: ["team"], hidden: true },
        ],
      },
      muse: { ok: true, accounts: 3 },
    },
    health: {
      agy: { lastOkAt: new Date(now - 40_000).toISOString(), lastErrAt: null, lastError: null, lastMs: 4012 },
      codex: { lastOkAt: new Date(now - 9 * 60_000).toISOString(), lastErrAt: new Date(now - 30 * 60_000).toISOString(), lastError: null, lastMs: 7210 },
      muse: { lastOkAt: new Date(now - 3 * 60_000).toISOString(), lastErrAt: new Date(now - 60_000).toISOString(), lastError: "muse2api 429: chat đang bận", lastMs: 18_400 },
    },
    cooldowns: { muse: now + 95_000 },
  };
}

// Độ trễ mẫu theo model (ms) — dùng cho Chạy thử / Đo nhanh ở chế độ demo.
const DEMO_MS: Record<string, number> = {
  "gemini-3.8-flash-low": 4000,
  "claude-sonnet-5-5-low": 4600,
  "gemini-3.8-flash-medium": 15_200,
  "gemini-3.8-flash-high": 21_000,
  "gemini-3.8-pro-low": 9_800,
  "gemini-3.8-pro-high": 24_500,
  "claude-sonnet-5-5-medium": 7_900,
  "claude-sonnet-5-5-high": 12_600,
  "claude-opus-5-5-low": 6_300,
  "claude-opus-5-5-medium": 10_400,
  "claude-opus-5-5-high": 16_800,
  "gpt-6.1-sol": 13_600,
  "gpt-6-luna": 7_200,
  "gpt-6.1-sol-mini": 8_900,
  muse: 17_800,
};

export async function demoTest(body: { provider: string; model?: string; idea: string }, signal?: AbortSignal): Promise<TestResult> {
  const base = DEMO_MS[body.model ?? body.provider] ?? 6000;
  const ms = Math.round(base * (0.9 + Math.random() * 0.2));
  // Chờ rút gọn (1/6 thời gian thật) để trình bày nhanh.
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, Math.min(3200, ms / 6));
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("aborted", "AbortError"))));
  });
  const startMs = body.provider === "agy" ? 15 : body.provider === "codex" ? 1800 : 600;
  const sessionMs = body.provider === "agy" ? 40 : body.provider === "codex" ? 900 : 1200;
  return {
    text: `Cận cảnh ${body.idea.toLowerCase()}, ánh nắng sớm xiên qua khung cửa, hạt bụi lơ lửng, tông hổ phách ấm, độ sâu trường ảnh nông, máy quay trượt chậm sang phải.`,
    ms,
    breakdown: { startMs, sessionMs, modelMs: Math.max(0, ms - startMs - sessionMs) },
    provider: body.provider,
    model: body.model,
  };
}
