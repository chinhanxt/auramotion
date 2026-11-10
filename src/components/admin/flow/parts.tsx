"use client";

import { BaseEdge, EdgeLabelRenderer, Handle, Position, getBezierPath, type EdgeProps, type Node, type NodeProps, type Edge } from "@xyflow/react";
import { createContext, memo, useContext } from "react";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Monogram } from "../ai/Monogram";
import type { LaneData, PipeEdgeData, PipeNodeData } from "./graph";
import type { EdgeVisual, FlowAi, NodeVisual } from "./types";

// ───────── Trạng thái hiển thị chung (context) ─────────

export type NodeLive = { state: NodeVisual; count?: number; ai?: FlowAi; badge?: string; note?: string };
export type FlowVisual = {
  nodes: Record<string, NodeLive>;
  edges: Record<string, EdgeVisual>;
  reduced: boolean;
  replay: boolean;
};
export const FlowCtx = createContext<FlowVisual>({ nodes: {}, edges: {}, reduced: false, replay: false });

export const KIND_ICON: Record<string, IconName> = {
  user: "user",
  api: "server",
  queue: "layers",
  worker: "cpu",
  gateway: "route",
  skill: "wand",
  router: "sparkle",
  writer: "sparkle",
  guard: "shield",
  executor: "image",
  muse2api: "bolt",
  "muse-tab": "text",
  validate: "film",
  storage: "download",
  realtime: "pulse",
  ui: "grid",
  plan: "story",
  shot: "video",
  assemble: "cut",
};

export function roleOf(d: { kind: string; role?: string }): string | null {
  if (d.kind === "writer") return d.role === "planner" ? "AI lập kịch bản" : "AI viết";
  if (d.kind === "router") return "AI chọn";
  if (d.kind === "executor" || d.kind === "shot") return "AI thực thi";
  if (d.kind === "guard") return "Luật";
  return null;
}

export const STAT_LABEL: Record<string, string> = {
  active: "chạy",
  waiting: "chờ",
  failed: "lỗi",
  done: "xong",
  held: "giữ",
  online: "online",
  tabs: "tab",
  accounts: "tk",
  skills: "skill",
  candidates: "ứng viên",
  clients: "kết nối",
  cache: "cache",
  fixed: "sửa",
  limit: "slot",
};

function Stats({ stats }: { stats?: Record<string, number | string | null | undefined> }) {
  if (!stats) return null;
  const entries = Object.entries(stats).filter(([k, v]) => v !== null && v !== undefined && k !== "limit");
  if (entries.length === 0) return null;
  const limit = stats.limit;
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {entries.slice(0, 3).map(([k, v]) => {
        const hot = k === "active" && Number(v) > 0;
        return (
          <span key={k} className={cx("pn-stat", hot && "pn-stat-hot", k === "failed" && Number(v) > 0 && "pn-stat-bad")}>
            {k === "ms" ? (
              <>
                <Icon name="clock" size={10} />
                {v}
              </>
            ) : (
              <>
                <b>
                  {v}
                  {k === "active" && limit !== undefined && limit !== null ? <span className="opacity-60">/{limit}</span> : null}
                </b>
                {STAT_LABEL[k] ?? k}
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

export type PipeNodeT = Node<PipeNodeData, "pipe">;

export const PipeNode = memo(function PipeNode({ id, data }: NodeProps<PipeNodeT>) {
  const vis = useContext(FlowCtx);
  const live = vis.nodes[id];
  const state: NodeVisual = live?.state ?? "idle";
  const ai = live?.ai ?? data.ai;
  const role = roleOf(data);
  const mono = ai?.provider && (data.kind === "writer" || data.kind === "executor" || data.kind === "shot" || data.kind === "router");
  const count = live?.count ?? 0;
  const model = [ai?.provider && mono ? null : ai?.provider, ai?.model].filter(Boolean).join(" · ");
  return (
    <div className={cx("pn", `pn-${state}`, mono && "pn-ai")} data-kind={data.kind}>
      <Handle type="target" position={Position.Left} id="l" className="pn-h" />
      <Handle type="target" position={Position.Top} id="t" className="pn-h" />
      <span className="pn-glow" aria-hidden="true" />
      <div className="flex items-start gap-2.5">
        {mono ? (
          <Monogram provider={ai!.provider} size={30} />
        ) : (
          <span className="pn-icon">
            <Icon name={KIND_ICON[data.kind] ?? "cpu"} size={16} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] leading-tight font-semibold">{data.title}</span>
            {count > 0 && <span className="pn-count">{count}</span>}
          </div>
          {role ? <span className="pn-role">{role}</span> : data.subtitle && <span className="block truncate text-[11px] text-muted">{data.subtitle}</span>}
        </div>
        {live?.badge && <span className="pn-badge">{live.badge}</span>}
      </div>
      {role && data.subtitle && !model && <span className="mt-1.5 block truncate text-[11px] text-muted">{data.subtitle}</span>}
      {(model || ai?.account) && (
        <span className="mt-2 flex min-w-0 items-center gap-1">
          {model && <span className="pn-chip">{model}</span>}
          {ai?.account && <span className="pn-chip pn-chip-acc">{ai.account}</span>}
        </span>
      )}
      {live?.note ? <span className="pn-note">{live.note}</span> : <Stats stats={data.stats} />}
      <Handle type="source" position={Position.Right} id="r" className="pn-h" />
      <Handle type="source" position={Position.Bottom} id="b" className="pn-h" />
    </div>
  );
});

export type LaneNodeT = Node<LaneData, "lane">;
export const LaneNode = memo(function LaneNode({ data }: NodeProps<LaneNodeT>) {
  return (
    <div className="fl-lane">
      <span className="fl-lane-label">{data.label}</span>
    </div>
  );
});

// ───────── Cạnh: vạch gradient chảy + hạt chạy dọc đường (animateMotion) ─────────

// Đường "xuống dòng": phải → xuống làn giữa → trái → vào nút hàng dưới, bo góc.
function wrapPath(sx: number, sy: number, tx: number, ty: number, busY: number): string {
  const out = 26;
  const pts: [number, number][] = [
    [sx, sy],
    [sx + out, sy],
    [sx + out, busY],
    [tx - out, busY],
    [tx - out, ty],
    [tx, ty],
  ];
  const r = 14;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx_, cy] = pts[i];
    const [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx_ - px, cy - py);
    const l2 = Math.hypot(nx - cx_, ny - cy);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) {
      d += ` L${cx_},${cy}`;
      continue;
    }
    const ax = cx_ - ((cx_ - px) / l1) * rr;
    const ay = cy - ((cy - py) / l1) * rr;
    const bx = cx_ + ((nx - cx_) / l2) * rr;
    const by = cy + ((ny - cy) / l2) * rr;
    d += ` L${ax},${ay} Q${cx_},${cy} ${bx},${by}`;
  }
  d += ` L${pts[pts.length - 1][0]},${pts[pts.length - 1][1]}`;
  return d;
}

export type PipeEdgeT = Edge<PipeEdgeData, "pipe">;

const safe = (id: string) => id.replace(/[^\w-]/g, "_");

export const PipeEdge = memo(function PipeEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data }: EdgeProps<PipeEdgeT>) {
  const vis = useContext(FlowCtx);
  const state: EdgeVisual = vis.edges[id] ?? (vis.replay ? "dim" : "idle");
  let d: string;
  let lx: number;
  let ly: number;
  if (data?.route === "wrap" && data.busY !== undefined) {
    d = wrapPath(sourceX, sourceY, targetX, targetY, data.busY);
    lx = (sourceX + targetX) / 2;
    ly = data.busY;
  } else {
    [d, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });
  }
  const g = `fg-${safe(id)}`;
  const hot = state === "active";
  const vertical = data?.route !== "curve";
  const dur = hot ? 1.1 : 3.4 + (Math.abs(targetX - sourceX) + Math.abs(targetY - sourceY)) / 900;
  const showDot = !vis.reduced && state !== "dim" && !(vis.replay && state !== "active");
  return (
    <g className={cx("fe", `fe-${state}`, data?.fallback && "fe-fallback")}>
      <defs>
        <linearGradient id={g} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={vertical ? sourceX : targetX} y2={vertical ? targetY : sourceY}>
          <stop offset="0%" stopColor={hot ? "#d4ff3a" : "#7c5cff"} />
          <stop offset="55%" stopColor={hot ? "#e9ff9a" : "#ff4fd8"} />
          <stop offset="100%" stopColor={hot ? "#d4ff3a" : "#ffb36b"} />
        </linearGradient>
      </defs>
      <BaseEdge path={d} className="fe-base" />
      <path d={d} data-fp={id} className="fe-flow" stroke={`url(#${g})`} fill="none" />
      {showDot && (
        <circle r={hot ? 3.6 : 2.4} className="fe-dot" fill={hot ? "#efffb0" : "#ffd7f4"}>
          <animateMotion dur={`${dur.toFixed(2)}s`} repeatCount="indefinite" path={d} begin={`-${((id.length * 0.37) % dur).toFixed(2)}s`} />
        </circle>
      )}
      {data?.label && (
        <EdgeLabelRenderer>
          <div className={cx("fe-label nodrag nopan", hot && "fe-label-hot")} style={{ transform: `translate(-50%,-50%) translate(${lx}px,${ly}px)` }}>
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
});
