// Dữ liệu `/api/admin/flow` (docs/v2-ai-runtime.md) + vài loại nút chỉ dựng phía trình duyệt (ui, plan, shot, assemble).
import type { JobTrace } from "@/lib/api-client";

export type NodeKind =
  | "user"
  | "api"
  | "queue"
  | "worker"
  | "gateway"
  | "skill"
  | "router"
  | "writer"
  | "guard"
  | "executor"
  | "muse2api"
  | "muse-tab"
  | "validate"
  | "storage"
  | "realtime"
  | "ui"
  | "plan"
  | "shot"
  | "assemble";

export type FlowAi = { provider: string; model?: string | null; account?: string | null };
export type FlowNode = {
  id: string;
  kind: NodeKind | string;
  title: string;
  subtitle?: string;
  ai?: FlowAi;
  stats?: Record<string, number | string | null | undefined>;
  // Story: số thứ tự cảnh; writer của Story: vai "lập kịch bản".
  index?: number;
  role?: "planner";
};
export type FlowEdge = { from: string; to: string; label?: string };
export type ActiveJob = { id: string; kind?: string; stage?: string; node?: string };
export type FlowLive = { queues?: Record<string, unknown>; slots?: Record<string, unknown>; activeJobs?: ActiveJob[] };
export type FlowGraph = { nodes: FlowNode[]; edges: FlowEdge[] };
export type FlowData = FlowGraph & { live?: FlowLive; story?: FlowGraph };

export type FlowJob = {
  id: string;
  kind?: "IMAGE" | "VIDEO" | "ASSEMBLE" | string;
  status?: string;
  prompt?: string;
  createdAt?: string | number;
  storyId?: string | null;
  shotIndex?: number | null;
  trace?: JobTrace | null;
  user?: { email?: string } | null;
};

export type Tab = "media" | "story";

// Trạng thái hiển thị (sống / phát lại) — đọc qua context, không nằm trong node.data để tránh đo lại kích thước.
export type NodeVisual = "idle" | "active" | "current" | "visited" | "path" | "dim" | "failed";
export type EdgeVisual = "idle" | "active" | "visited" | "path" | "dim";
