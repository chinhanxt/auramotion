// Dựng sơ đồ (vị trí đặt tay theo làn) + đường đi của 1 job để phát lại.
import type { Edge, Node } from "@xyflow/react";
import type { JobTrace } from "@/lib/api-client";
import type { FlowAi, FlowData, FlowEdge, FlowGraph, FlowJob, FlowNode, Tab } from "./types";

export const NODE_W = 216;
export const NODE_H = 112;
const COL = 272;
const PITCH = 128;
const ROW_GAP = 128;

type Place = Record<string, [row: number, col: number]>;
type Lane = { row: number; from: number; to: number; label: string };

const LAYOUT: Record<Tab, { place: Place; lanes: Lane[]; fallbackRow: number }> = {
  media: {
    place: {
      user: [0, 0],
      api: [0, 1],
      queue: [0, 2],
      worker: [0, 3],
      gateway: [0, 4],
      skill: [1, 1],
      router: [1, 2],
      writer: [1, 3],
      guard: [1, 4],
      executor: [2, 0],
      muse2api: [2, 1],
      "muse-tab": [2, 2],
      validate: [2, 3],
      storage: [2, 4],
      realtime: [2, 5],
      ui: [2, 6],
    },
    lanes: [
      { row: 0, from: 0, to: 4, label: "Tiếp nhận" },
      { row: 1, from: 1, to: 4, label: "AI viết" },
      { row: 2, from: 0, to: 2, label: "AI thực thi" },
      { row: 2, from: 3, to: 6, label: "Giao kết quả" },
    ],
    fallbackRow: 2,
  },
  story: {
    place: {
      user: [0, 0],
      api: [0, 1],
      queue: [0, 2],
      writer: [0, 3],
      plan: [0, 4],
      shot: [1, 0],
      muse2api: [1, 1],
      validate: [1, 2],
      assemble: [1, 3],
      storage: [1, 4],
      realtime: [1, 5],
      ui: [1, 6],
    },
    lanes: [
      { row: 0, from: 0, to: 2, label: "Tiếp nhận" },
      { row: 0, from: 3, to: 4, label: "Lập kịch bản" },
      { row: 1, from: 0, to: 1, label: "Quay song song" },
      { row: 1, from: 2, to: 6, label: "Ghép & giao" },
    ],
    fallbackRow: 1,
  },
};

export type PipeNodeData = FlowNode & { tab: Tab; [k: string]: unknown };
export type LaneData = { label: string; [k: string]: unknown };
export type PipeEdgeData = { route: "wrap" | "down" | "curve"; busY?: number; label?: string; fallback?: boolean; [k: string]: unknown };

export const edgeId = (from: string, to: string) => `${from}->${to}`;

// Thêm nút "Giao diện" cuối luồng nếu backend chưa có.
export function withUi(g: FlowGraph): FlowGraph {
  if (g.nodes.some((n) => n.kind === "ui")) return g;
  const rt = g.nodes.find((n) => n.kind === "realtime");
  if (!rt) return g;
  return {
    nodes: [...g.nodes, { id: "ui", kind: "ui", title: "Giao diện", subtitle: "Skeleton → kết quả · toast" }],
    edges: [...g.edges, { from: rt.id, to: "ui" }],
  };
}

export function buildLayout(g0: FlowGraph, tab: Tab): { nodes: Node[]; edges: Edge[] } {
  const g = withUi(g0);
  const { place, lanes, fallbackRow } = LAYOUT[tab];
  const maxCol = Math.max(...Object.values(place).map(([, c]) => c));
  // Gom nút theo ô (hàng, cột); loại lạ xếp sau cùng của hàng cuối.
  const extra = new Map<string, number>();
  const cell = (n: FlowNode): [number, number] => {
    const p = place[n.kind];
    if (p) return p;
    if (!extra.has(n.kind)) extra.set(n.kind, maxCol + 1 + extra.size);
    return [fallbackRow, extra.get(n.kind)!];
  };
  const cells = new Map<string, FlowNode[]>();
  for (const n of g.nodes) {
    const [r, c] = cell(n);
    const k = `${r}:${c}`;
    cells.set(k, [...(cells.get(k) ?? []), n]);
  }
  const rows = Math.max(...g.nodes.map((n) => cell(n)[0])) + 1;
  const rowSpan = Array.from({ length: rows }, (_, r) => Math.max(1, ...[...cells.entries()].filter(([k]) => k.startsWith(`${r}:`)).map(([, v]) => v.length)));
  const rowTop: number[] = [];
  let y = 0;
  for (let r = 0; r < rows; r++) {
    rowTop.push(y);
    y += rowSpan[r] * PITCH - (PITCH - NODE_H) + ROW_GAP;
  }
  const rowMid = (r: number) => rowTop[r] + (rowSpan[r] * PITCH - (PITCH - NODE_H)) / 2;

  const pos = new Map<string, { x: number; y: number; row: number; col: number }>();
  for (const [k, list] of cells) {
    const [r, c] = k.split(":").map(Number);
    const h = list.length * PITCH - (PITCH - NODE_H);
    list.forEach((n, i) => pos.set(n.id, { x: c * COL, y: rowMid(r) - h / 2 + i * PITCH, row: r, col: c }));
  }

  const laneNodes: Node[] = lanes
    .filter((l) => l.row < rows)
    .map((l, i) => {
      const top = rowTop[l.row] - 34;
      const h = rowSpan[l.row] * PITCH - (PITCH - NODE_H) + 54;
      return {
        id: `lane-${i}`,
        type: "lane",
        position: { x: l.from * COL - 22, y: top },
        data: { label: l.label } satisfies LaneData,
        width: (l.to - l.from) * COL + NODE_W + 44,
        height: h,
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        zIndex: -1,
      };
    });

  const nodes: Node[] = [
    ...laneNodes,
    ...g.nodes.map((n) => {
      const p = pos.get(n.id)!;
      return { id: n.id, type: "pipe", position: { x: p.x, y: p.y }, data: { ...n, tab } satisfies PipeNodeData, draggable: false, connectable: false };
    }),
  ];

  const edges: Edge[] = g.edges
    .filter((e) => pos.has(e.from) && pos.has(e.to))
    .map((e) => {
      const a = pos.get(e.from)!;
      const b = pos.get(e.to)!;
      const down = a.col === b.col && a.row === b.row && b.y > a.y;
      const wrap = b.row > a.row && b.x <= a.x + COL / 2;
      const busY = wrap ? rowTop[b.row] - ROW_GAP / 2 - 4 : undefined;
      const data: PipeEdgeData = { route: down ? "down" : wrap ? "wrap" : "curve", busY, label: e.label, fallback: down };
      return {
        id: edgeId(e.from, e.to),
        source: e.from,
        target: e.to,
        type: "pipe",
        sourceHandle: down ? "b" : "r",
        targetHandle: down ? "t" : "l",
        data,
        focusable: false,
      };
    });
  return { nodes, edges };
}

// Đồ thị Story: lấy từ backend (`data.story`) hoặc dựng theo cấu hình (planner chain + slot chat phụ).
export function storyGraph(data: FlowData | undefined, planners: FlowAi[], shots = 4): FlowGraph {
  if (data?.story?.nodes?.length) return data.story;
  const tabs = (data?.nodes ?? []).filter((n) => n.kind === "muse-tab" && !/main|chính/i.test(`${n.id} ${n.title}`));
  const pl = planners.length ? planners : [{ provider: "muse", model: "muse-chat" }];
  const nodes: FlowNode[] = [
    { id: "s-user", kind: "user", title: "Ý tưởng Story", subtitle: "Tiêu đề · số cảnh · tỷ lệ" },
    { id: "s-api", kind: "api", title: "API", subtitle: "Giữ Credit kế hoạch" },
    { id: "s-queue", kind: "queue", title: "Hàng đợi story", subtitle: "BullMQ · story" },
    ...pl.map((p, i) => ({
      id: `s-plan-${i}`,
      kind: "writer",
      role: "planner" as const,
      title: p.provider === "muse" ? "Muse chat chính" : p.provider === "agy" ? "agy" : "Codex",
      subtitle: i === 0 ? (p.provider === "muse" ? "Giữ thread · lập kịch bản" : "Lập kịch bản") : `Dự phòng ${i}`,
      ai: p,
    })),
    { id: "s-plan", kind: "plan", title: "Kịch bản", subtitle: `${shots} cảnh · sửa được trước khi quay` },
    ...Array.from({ length: shots }, (_, i) => {
      const tab = tabs[i % Math.max(1, tabs.length)];
      return {
        id: `s-shot-${i}`,
        kind: "shot",
        index: i,
        title: `Cảnh ${i + 1}`,
        subtitle: `Chat phụ ${i + 1} · job video`,
        ai: { provider: "muse", model: "muse-video", account: tab?.ai?.account ?? (i % 2 ? "acc2" : "acc1") },
      };
    }),
    { id: "s-m2a", kind: "muse2api", title: "muse2api", subtitle: "N chat phụ song song" },
    { id: "s-validate", kind: "validate", title: "Kiểm file", subtitle: "ffprobe từng cảnh" },
    { id: "s-assemble", kind: "assemble", title: "Ghép", subtitle: "VieNeu · nhạc · phụ đề" },
    { id: "s-storage", kind: "storage", title: "Lưu trữ", subtitle: "Video cuối" },
    { id: "s-sse", kind: "realtime", title: "Realtime", subtitle: "SSE story + job" },
  ];
  const edges: FlowEdge[] = [
    { from: "s-user", to: "s-api" },
    { from: "s-api", to: "s-queue" },
    { from: "s-queue", to: "s-plan-0" },
    ...pl.slice(1).map((_, i) => ({ from: `s-plan-${i}`, to: `s-plan-${i + 1}`, label: "lỗi" })),
    ...pl.map((_, i) => ({ from: `s-plan-${i}`, to: "s-plan" })),
    ...Array.from({ length: shots }, (_, i) => ({ from: "s-plan", to: `s-shot-${i}`, label: i === 0 ? "song song" : undefined })),
    ...Array.from({ length: shots }, (_, i) => ({ from: `s-shot-${i}`, to: "s-m2a" })),
    { from: "s-m2a", to: "s-validate" },
    { from: "s-validate", to: "s-assemble" },
    { from: "s-assemble", to: "s-storage" },
    { from: "s-storage", to: "s-sse" },
  ];
  return { nodes, edges };
}

// ───────── Phát lại: đường đi + mốc thời gian ─────────

export type Hop = { id: string; arrive: number; leave: number };
export type Seg = { kind: "dwell" | "travel"; hop: number; a: number; b: number; va: number; vb: number; edge?: string; reverse?: boolean };
export type Replay = { hops: Hop[]; segs: Seg[]; start: number; end: number; vTotal: number; failedAt?: string };

const norm = (s?: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, "");

function score(n: FlowNode, ai?: { provider?: string; model?: string | null; account?: string | null }, job?: FlowJob): number {
  let s = 0;
  if (ai && n.ai) {
    if (norm(n.ai.provider) === norm(ai.provider)) s += 4;
    if (ai.model && n.ai.model && norm(n.ai.model).startsWith(norm(ai.model))) s += 3;
    if (ai.account && n.ai.account && norm(n.ai.account) === norm(ai.account)) s += 2;
    if (ai.model && /video/i.test(ai.model) && /video/i.test(`${n.title} ${n.ai.model}`)) s += 1;
  }
  if (job?.kind === "VIDEO" && /video/i.test(`${n.title} ${n.ai?.model ?? ""}`)) s += 1;
  if (job?.shotIndex !== undefined && job.shotIndex !== null && n.index === job.shotIndex) s += 6;
  return s;
}

function best(nodes: FlowNode[], kind: string, ai?: Parameters<typeof score>[1], job?: FlowJob): FlowNode | undefined {
  const list = nodes.filter((n) => n.kind === kind);
  if (list.length <= 1) return list[0];
  return [...list].sort((x, y) => score(y, ai, job) - score(x, ai, job))[0];
}

export function buildReplay(g0: FlowGraph, tab: Tab, job: FlowJob, t: JobTrace): Replay | null {
  const g = withUi(g0);
  const c = t.createdAt ?? t.queuedAt ?? t.writeStart ?? t.submitAt;
  if (c === undefined) return null;
  const end = t.doneAt ?? t.failedAt ?? Math.max(c, t.submitAt ?? t.slotAt ?? t.writeEnd ?? c) + 1000;
  const q = t.queuedAt ?? c;
  const ws = t.writeStart;
  const rms = t.router?.method === "ai" ? (t.router.ms ?? 0) : 0;
  const we = t.writeEnd ?? ws;
  const sl = t.slotAt ?? we ?? q;
  const sb = t.submitAt ?? sl;
  const muse = norm(t.engine?.provider).startsWith("muse");
  const wrote = ws !== undefined;

  type Step = [kind: string, a: number | undefined, b: number | undefined, ai?: Parameters<typeof score>[1]];
  const steps: Step[] =
    tab === "story"
      ? [
          ["user", c, c],
          ["api", c, c],
          ["queue", q, ws ?? sl],
          ...(wrote ? ([["writer", ws, we, t.writer]] as Step[]) : []),
          ["plan", we ?? sl, we ?? sl],
          ["shot", we ?? sl, sb, t.engine],
          ["muse2api", sb, end],
          ["validate", end, end],
          ["assemble", end, end],
          ["storage", end, end],
          ["realtime", end, end],
          ["ui", end, end],
        ]
      : [
          ["user", c, c],
          ["api", c, c],
          ["queue", q, ws ?? sl],
          ["worker", ws ?? sl, ws ?? sl],
          ...(wrote
            ? ([
                ["gateway", ws, ws],
                ["skill", ws, ws],
                ...(rms > 0 ? ([["router", ws, ws! + rms]] as Step[]) : []),
                ["writer", ws! + rms, we, t.writer],
                ["guard", we, we],
              ] as Step[])
            : []),
          ["executor", we ?? q, muse ? sb : end, t.engine],
          ...(muse ? ([["muse2api", sb, sb], ["muse-tab", sb, end, { provider: "muse", account: t.engine?.account }]] as Step[]) : []),
          ["validate", end, end],
          ["storage", end, end],
          ["realtime", end, end],
          ["ui", end, end],
        ];

  // Job lỗi: dừng ở chặng đang chạy lúc lỗi.
  let stopKind: string | undefined;
  if (t.failedAt) {
    stopKind = wrote && t.writeEnd === undefined ? "writer" : t.submitAt === undefined ? (tab === "story" ? "shot" : "executor") : muse && tab === "media" ? "muse-tab" : tab === "story" ? "muse2api" : "executor";
  }

  const hops: Hop[] = [];
  let last = c;
  for (const [kind, a, b, ai] of steps) {
    const n = best(g.nodes, kind, ai, job);
    if (!n) continue;
    const arrive = Math.max(last, a ?? last);
    const leave = Math.max(arrive, b ?? arrive);
    hops.push({ id: n.id, arrive, leave: kind === stopKind ? Math.max(arrive, t.failedAt!) : leave });
    last = hops[hops.length - 1].leave;
    if (kind === stopKind) break;
  }
  if (hops.length < 2) return null;

  const edges = new Set(g.edges.map((e) => edgeId(e.from, e.to)));
  const total = Math.max(1, last - c);
  const segs: Seg[] = [];
  let v = 0;
  hops.forEach((h, i) => {
    const dwell = h.leave - h.arrive;
    const vd = 0.12 + (5.5 * dwell) / total;
    segs.push({ kind: "dwell", hop: i, a: h.arrive, b: h.leave, va: v, vb: v + vd });
    v += vd;
    const nx = hops[i + 1];
    if (!nx) return;
    const tr = nx.arrive - h.leave;
    const vt = 0.42 + (5.5 * tr) / total;
    const fwd = edgeId(h.id, nx.id);
    const rev = edgeId(nx.id, h.id);
    segs.push({ kind: "travel", hop: i, a: h.leave, b: nx.arrive, va: v, vb: v + vt, edge: edges.has(fwd) ? fwd : edges.has(rev) ? rev : undefined, reverse: !edges.has(fwd) && edges.has(rev) });
    v += vt;
  });
  return { hops, segs, start: c, end: last, vTotal: v, failedAt: stopKind ? hops[hops.length - 1].id : undefined };
}

export function segAt(r: Replay, v: number): { seg: Seg; frac: number } {
  const vv = Math.max(0, Math.min(r.vTotal, v));
  const seg = r.segs.find((s) => vv <= s.vb) ?? r.segs[r.segs.length - 1];
  const frac = seg.vb > seg.va ? (vv - seg.va) / (seg.vb - seg.va) : 1;
  return { seg, frac };
}

export function realAt(r: Replay, v: number): number {
  const { seg, frac } = segAt(r, v);
  return seg.a + (seg.b - seg.a) * frac;
}

export function visualAt(r: Replay, t: number): number {
  const seg = r.segs.find((s) => t <= s.b) ?? r.segs[r.segs.length - 1];
  const frac = seg.b > seg.a ? Math.max(0, Math.min(1, (t - seg.a) / (seg.b - seg.a))) : 1;
  return seg.va + (seg.vb - seg.va) * frac;
}
