// Dữ liệu mẫu cho `/admin/flow?demo=1` — dựng theo cấu hình thật (docs/v2-ai-runtime.md, v2-plan.md §0). Giữ lại để trình bày.
import type { JobTrace } from "@/lib/api-client";
import type { FlowData, FlowJob } from "./types";

export function demoFlow(tick = 0): FlowData {
  const wave = (n: number, k: number) => Math.max(0, Math.round(n + Math.sin((tick + k) / 2) * n * 0.6));
  return {
    nodes: [
      { id: "user", kind: "user", title: "Người dùng", subtitle: "Ý tưởng ở Studio", stats: { online: 12 + (tick % 3) } },
      { id: "api", kind: "api", title: "API", subtitle: "Giữ Credit · tạo job", stats: { held: wave(4, 1) } },
      { id: "queue", kind: "queue", title: "BullMQ", subtitle: "muse · cli · post · story", stats: { waiting: wave(3, 2), active: wave(4, 0) } },
      { id: "worker", kind: "worker", title: "Worker", subtitle: "Xin slot · điều phối", stats: { active: wave(4, 0) } },
      { id: "gateway", kind: "gateway", title: "AI Gateway", subtitle: "Lần lượt · 60 s · cache 72 g", stats: { cache: "61%" } },
      { id: "skill", kind: "skill", title: "Lọc skill", subtitle: "Luật: ~50 → 10 ứng viên", stats: { skills: 52, candidates: 10 } },
      { id: "router", kind: "router", title: "AI chọn skill", subtitle: "Router nhanh chọn 1", ai: { provider: "agy", model: "gemini-3.8-flash-low" }, stats: { ms: "0.9 s" } },
      { id: "w-agy", kind: "writer", title: "agy", subtitle: "ACP chạy sẵn", ai: { provider: "agy", model: "gemini-3.8-flash-low" }, stats: { ms: "4.0 s" } },
      { id: "w-codex", kind: "writer", title: "Codex", subtitle: "Dự phòng 1", ai: { provider: "codex", model: "gpt-6-luna · low" }, stats: { ms: "7.2 s" } },
      { id: "w-muse", kind: "writer", title: "Muse chat", subtitle: "Dự phòng 2", ai: { provider: "muse", model: "muse-chat" }, stats: { ms: "18 s" } },
      { id: "guard", kind: "guard", title: "Kiểm prompt", subtitle: "Lint luật + tự sửa", stats: { fixed: "18%" } },
      // Mỗi model đang bật = 1 nút engine (như backend); sơ đồ trực tiếp gộp theo provider, không hiện model.
      { id: "exec:m-muse-img", kind: "executor", title: "Muse Image", subtitle: "MUSE · IMAGE", ai: { provider: "muse", model: "muse-image", account: "acc1" }, stats: { activeJobs: wave(1, 3) } },
      { id: "exec:m-muse-img2", kind: "executor", title: "Muse Image · TK2", subtitle: "MUSE · IMAGE", ai: { provider: "muse", model: "muse-image", account: "acc2" }, stats: { activeJobs: wave(1, 5) } },
      { id: "exec:m-muse-vid", kind: "executor", title: "Muse Video", subtitle: "MUSE · VIDEO", ai: { provider: "muse", model: "muse-video" }, stats: { activeJobs: wave(1, 1) } },
      { id: "exec:m-gemini", kind: "executor", title: "Gemini 3.8 Flash", subtitle: "AGY · IMAGE", ai: { provider: "agy", model: "gemini-3.8-flash-low" }, stats: { activeJobs: 0 } },
      { id: "exec:m-claude", kind: "executor", title: "Claude Opus 5.5", subtitle: "AGY · IMAGE", ai: { provider: "agy", model: "claude-opus-5-5-low" }, stats: { activeJobs: 0 } },
      { id: "exec:m-sol", kind: "executor", title: "GPT-6.1 Sol", subtitle: "CODEX · IMAGE", ai: { provider: "codex", model: "gpt-6.1-sol" }, stats: { activeJobs: tick % 4 === 0 ? 1 : 0 } },
      { id: "m2a", kind: "muse2api", title: "muse2api", subtitle: ":18610 · CDP 19230", stats: { tabs: 6, accounts: 2 } },
      { id: "tab-1", kind: "muse-tab", title: "Chat phụ 1", subtitle: "acc1 · thread mới", ai: { provider: "muse", account: "acc1" }, stats: { active: wave(1, 3) } },
      { id: "tab-2", kind: "muse-tab", title: "Chat phụ 2", subtitle: "acc2 · thread mới", ai: { provider: "muse", account: "acc2" }, stats: { active: wave(1, 5) } },
      { id: "tab-3", kind: "muse-tab", title: "Chat phụ 3", subtitle: "acc1 · video", ai: { provider: "muse", account: "acc1" }, stats: { active: wave(1, 1) } },
      { id: "validate", kind: "validate", title: "Kiểm file", subtitle: "ffprobe · kích thước thật", stats: { done: 128 + tick } },
      { id: "storage", kind: "storage", title: "Lưu trữ", subtitle: "data/media · trừ Credit" },
      { id: "sse", kind: "realtime", title: "Realtime", subtitle: "Redis pub/sub → SSE", stats: { clients: 9 } },
    ],
    edges: [
      { from: "user", to: "api" },
      { from: "api", to: "queue" },
      { from: "queue", to: "worker" },
      { from: "worker", to: "gateway", label: "AI viết" },
      { from: "gateway", to: "skill", label: "ý tưởng" },
      { from: "skill", to: "router", label: "10" },
      { from: "router", to: "w-agy" },
      { from: "w-agy", to: "w-codex", label: "lỗi" },
      { from: "w-codex", to: "w-muse", label: "lỗi" },
      { from: "w-agy", to: "guard" },
      { from: "w-codex", to: "guard" },
      { from: "w-muse", to: "guard" },
      ...["exec:m-muse-img", "exec:m-muse-img2", "exec:m-muse-vid", "exec:m-gemini", "exec:m-claude", "exec:m-sol"].map((to) => ({ from: "guard", to, label: "prompt" })),
      ...["exec:m-muse-img", "exec:m-muse-img2", "exec:m-muse-vid"].map((from) => ({ from, to: "m2a" })),
      ...["exec:m-gemini", "exec:m-claude", "exec:m-sol"].map((from) => ({ from, to: "validate" })),
      { from: "m2a", to: "tab-1" },
      { from: "m2a", to: "tab-2" },
      { from: "m2a", to: "tab-3" },
      { from: "tab-1", to: "validate" },
      { from: "tab-2", to: "validate" },
      { from: "tab-3", to: "validate" },
      { from: "validate", to: "storage" },
      { from: "storage", to: "sse" },
    ],
    live: {
      activeJobs: [
        { id: "j1", kind: "IMAGE", stage: "writing" },
        { id: "j2", kind: "IMAGE", node: "tab-2" },
        { id: "j3", kind: "VIDEO", node: "tab-3" },
        ...(tick % 2 ? [{ id: "j4", kind: "IMAGE", stage: "queued" }] : []),
        ...(tick % 3 === 0 ? [{ id: "j5", kind: "IMAGE", stage: "validating" }] : []),
      ],
    },
  };
}

const S = 1000;

function trace(base: number, p: Partial<Record<keyof JobTrace, number>>, rest: Pick<JobTrace, "writer" | "engine" | "error" | "router" | "guard">): JobTrace {
  const at = (k: keyof JobTrace) => (p[k] === undefined ? undefined : base + (p[k] as number));
  return {
    createdAt: base,
    queuedAt: at("queuedAt"),
    writeStart: at("writeStart"),
    writeEnd: at("writeEnd"),
    slotAt: at("slotAt"),
    submitAt: at("submitAt"),
    doneAt: at("doneAt"),
    failedAt: at("failedAt"),
    ...rest,
  };
}

export function demoJobs(now = Date.now()): FlowJob[] {
  return [
    {
      id: "demo-img-1",
      kind: "IMAGE",
      status: "SUCCEEDED",
      prompt: "Ly cà phê sữa đá, phố Sài Gòn mưa đêm",
      createdAt: now - 4 * 60 * S,
      user: { email: "lan@studio.vn" },
      trace: trace(
        now - 4 * 60 * S,
        { queuedAt: 40, writeStart: 310, writeEnd: 4300, slotAt: 6100, submitAt: 6400, doneAt: 35_900 },
        {
          writer: { provider: "agy", model: "gemini-3.8-flash-low", skill: "Món Việt", cache: false },
          router: { method: "ai", candidates: ["Món Việt", "Đồ uống", "Quán cà phê", "Phố đêm", "Đường phố"], chosen: "Món Việt", ms: 880 },
          guard: { fixes: ["bỏ chữ trên ảnh", "dịch sang tiếng Anh"] },
          engine: { provider: "muse", model: "muse-image", account: "acc2" },
        },
      ),
    },
    {
      id: "demo-vid-1",
      kind: "VIDEO",
      status: "SUCCEEDED",
      prompt: "Tà áo dài bay trong gió, hoàng hôn",
      createdAt: now - 11 * 60 * S,
      user: { email: "minh@shop.vn" },
      trace: trace(
        now - 11 * 60 * S,
        { queuedAt: 55, writeStart: 420, writeEnd: 12_100, slotAt: 21_000, submitAt: 41_000, doneAt: 132_000 },
        {
          writer: { provider: "codex", model: "gpt-6-luna", skill: "Chuyển động thời trang", cache: false },
          router: { method: "ai", candidates: ["Thời trang", "Lookbook", "Chuyển động thời trang", "Vlog"], chosen: "Chuyển động thời trang", ms: 1040 },
          guard: { fixes: ["bỏ tỷ lệ 9:16 trong prompt video", "bỏ zoom giật"] },
          engine: { provider: "muse", model: "muse-video", account: "acc1" },
        },
      ),
    },
    {
      id: "demo-img-2",
      kind: "IMAGE",
      status: "SUCCEEDED",
      prompt: "Đôi giày trắng trên nền cát, bóng đổ dài",
      createdAt: now - 26 * 60 * S,
      user: { email: "lan@studio.vn" },
      trace: trace(
        now - 26 * 60 * S,
        { queuedAt: 30, writeStart: 200, writeEnd: 240, slotAt: 900, submitAt: 1000, doneAt: 81_000 },
        {
          writer: { provider: "agy", model: "gemini-3.8-flash-low", skill: "Sản phẩm sạch", cache: true },
          router: { method: "rule", candidates: ["Sản phẩm sạch"], chosen: "Sản phẩm sạch", ms: 4 },
          guard: { fixes: [] },
          engine: { provider: "codex", model: "gpt-6.1-sol" },
        },
      ),
    },
    {
      id: "demo-img-3",
      kind: "IMAGE",
      status: "FAILED",
      prompt: "Chai nước hoa hổ phách trên bàn gỗ",
      createdAt: now - 48 * 60 * S,
      user: { email: "huy@brand.vn" },
      trace: trace(
        now - 48 * 60 * S,
        { queuedAt: 35, writeStart: 260, writeEnd: 4600, slotAt: 5200, submitAt: 5400, failedAt: 19_800 },
        { writer: { provider: "agy", model: "gemini-3.8-flash-low", skill: "Sản phẩm sạch", cache: false }, engine: { provider: "muse", model: "muse-image", account: "acc1" }, error: "QUOTA" },
      ),
    },
    {
      id: "demo-shot-2",
      kind: "VIDEO",
      status: "SUCCEEDED",
      prompt: "Story: Một ngày ở Hội An — cảnh 2",
      createdAt: now - 70 * 60 * S,
      storyId: "demo-story",
      shotIndex: 1,
      user: { email: "minh@shop.vn" },
      trace: trace(
        now - 70 * 60 * S,
        { queuedAt: 50, writeStart: 300, writeEnd: 19_400, slotAt: 24_000, submitAt: 44_000, doneAt: 140_000 },
        { writer: { provider: "muse", model: "muse-chat", skill: "Story du lịch", cache: false }, engine: { provider: "muse", model: "muse-video", account: "acc2" } },
      ),
    },
  ];
}
