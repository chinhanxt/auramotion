"use client";

import "@xyflow/react/dist/style.css";
import "./flow.css";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Node,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Empty, Notice, Skeleton } from "@/components/ui/Bits";
import { IconButton, LinkButton } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { Drawer } from "@/components/ui/Drawer";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { Select } from "@/components/ui/Select";
import { api, isNotFound, jobErrorText, toTrace, traceStages, type JobTrace } from "@/lib/api-client";
import { demoAi } from "../ai/demo";
import type { AiData } from "../ai/types";
import { LiveDot } from "../engine/live";
import { formatMs, timeAgo } from "../format";
import { usePoll } from "../hooks";
import { KV, PageHeader } from "../kit";
import { demoFlow, demoJobs } from "./demo";
import { buildLayout, buildReplay, realAt, segAt, storyGraph, visualAt, withUi, type PipeNodeData, type Replay } from "./graph";
import { FlowCtx, LaneNode, PipeEdge, PipeNode, roleOf, type FlowVisual, type NodeLive } from "./parts";
import type { ActiveJob, EdgeVisual, FlowData, FlowGraph, FlowJob, FlowNode, Tab } from "./types";

const nodeTypes = { pipe: PipeNode, lane: LaneNode };
const edgeTypes = { pipe: PipeEdge };

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return r;
}

// Giai đoạn job (live.activeJobs[].stage) → loại nút.
const STAGE_KIND: Record<string, string> = {
  queued: "queue",
  pending: "queue",
  waiting: "queue",
  routing: "router",
  skill: "skill",
  writing: "writer",
  write: "writer",
  guard: "guard",
  slot: "executor",
  rendering: "executor",
  running: "executor",
  submit: "muse-tab",
  muse: "muse-tab",
  downloading: "muse2api",
  validating: "validate",
  validate: "validate",
  storing: "storage",
  uploading: "storage",
  assembling: "assemble",
  planning: "writer",
};

function liveCounts(nodes: FlowNode[], jobs: ActiveJob[] = []): Record<string, number> {
  const out: Record<string, number> = {};
  const ids = new Set(nodes.map((n) => n.id));
  for (const j of jobs) {
    let id = j.node && ids.has(j.node) ? j.node : j.stage && ids.has(j.stage) ? j.stage : undefined;
    if (!id && j.stage) id = nodes.find((n) => n.kind === STAGE_KIND[j.stage!.toLowerCase()])?.id;
    if (id) out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

const DESC: Record<string, string> = {
  user: "Người dùng nhập ý tưởng hoặc prompt ở Studio.",
  api: "Kiểm tra gói, giữ Credit (hold) rồi tạo job.",
  queue: "BullMQ xếp job theo hàng: muse, cli, post, story.",
  worker: "Lấy job, gọi AI Gateway nếu bật AI viết, xin slot engine.",
  gateway: "Điều phối viết prompt: lọc skill → AI chọn skill → chuỗi AI viết → kiểm prompt. Có cache + viết trước.",
  skill: "Lọc bằng luật: từ ~50 skill giữ lại ~10 ứng viên khớp ý tưởng.",
  router: "AI nhanh chọn 1 skill cuối cùng trong các ứng viên.",
  writer: "Viết prompt từ ý tưởng theo template skill. Lỗi / quá giờ thì sang bước sau.",
  guard: "Lint prompt + tự sửa: bỏ tỷ lệ / định dạng trong prompt video, zoom giật, yêu cầu chữ / logo; ép tiếng Anh, độ dài.",
  executor: "Engine tạo ảnh / video từ prompt.",
  muse2api: "Cầu nối Chrome headless tới Muse; mỗi request media mở 1 chat phụ.",
  "muse-tab": "Một tab Muse chạy 1 việc; chat chính giữ thread cho Story.",
  validate: "Đo file bằng ffprobe: hỏng thì thử lại, ghi kích thước / thời lượng thật.",
  storage: "Lưu file kết quả, trừ Credit đã giữ (lỗi thì hoàn).",
  realtime: "Redis pub/sub → SSE: đẩy tiến độ, kết quả về trình duyệt.",
  ui: "Ô kết quả chuyển từ skeleton sang ảnh / video, kèm toast.",
  plan: "Kịch bản N cảnh do chat chính viết; sửa được trước khi quay.",
  shot: "Mỗi cảnh là 1 job video, chạy song song ở 1 chat phụ.",
  assemble: "Ghép các cảnh + giọng VieNeu + nhạc + phụ đề.",
};

const LINKS: Record<string, { href: string; label: string }[]> = {
  api: [{ href: "/admin/credit-rules", label: "Giá Credit" }],
  queue: [{ href: "/admin/queues", label: "Hàng đợi" }],
  worker: [{ href: "/admin/queues", label: "Hàng đợi" }],
  gateway: [{ href: "/admin/ai", label: "AI & Model" }],
  skill: [{ href: "/admin/skills", label: "Skill" }],
  router: [
    { href: "/admin/ai", label: "AI & Model" },
    { href: "/admin/skills", label: "Skill" },
  ],
  writer: [{ href: "/admin/ai", label: "AI & Model" }],
  guard: [{ href: "/admin/ai", label: "AI & Model" }],
  executor: [
    { href: "/admin/models", label: "Model" },
    { href: "/admin/muse", label: "Muse" },
  ],
  muse2api: [{ href: "/admin/muse", label: "Muse" }],
  "muse-tab": [{ href: "/admin/muse", label: "Muse" }],
  validate: [{ href: "/admin/jobs", label: "Tác vụ" }],
  storage: [{ href: "/admin/jobs", label: "Tác vụ" }],
  plan: [{ href: "/admin/stories", label: "Story" }],
  shot: [{ href: "/admin/stories", label: "Story" }],
  assemble: [{ href: "/admin/stories", label: "Story" }],
};

function toJobs(r: unknown): FlowJob[] {
  const list = Array.isArray(r) ? r : ((r as { items?: unknown[]; jobs?: unknown[] })?.items ?? (r as { jobs?: unknown[] })?.jobs ?? []);
  return (list as FlowJob[]).filter((j) => j && typeof j.id === "string");
}

const graphKey = (g: FlowGraph) => JSON.stringify([g.nodes.map((n) => [n.id, n.kind, n.title, n.subtitle, n.ai]), g.edges.map((e) => [e.from, e.to, e.label])]);

// ───────── Canvas ─────────

function Canvas({ graph, tab, visual, onOpen, replay, v }: { graph: FlowGraph; tab: Tab; visual: FlowVisual; onOpen: (n: FlowNode) => void; replay: Replay | null; v: number }) {
  const key = graphKey(graph);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const layout = useMemo(() => buildLayout(graph, tab), [key, tab]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const rf = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setNodes(layout.nodes);
    setEdges(layout.edges);
    const t = setTimeout(() => void rf.fitView({ duration: 500, padding: 0.08 }), 60);
    return () => clearTimeout(t);
  }, [layout, setNodes, setEdges, rf]);

  return (
    <FlowCtx.Provider value={visual}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode="dark"
        fitView
        fitViewOptions={{ padding: 0.08 }}
        minZoom={0.2}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => n.type === "pipe" && onOpen(n.data as PipeNodeData)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="rgba(255,255,255,.07)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          pannable
          zoomable
          position="bottom-right"
          className="max-md:!hidden"
          nodeBorderRadius={6}
          nodeColor={(n) => (n.type === "lane" ? "rgba(255,255,255,.025)" : (visual.nodes[n.id]?.state ?? "idle") === "idle" ? "rgba(255,255,255,.18)" : visual.nodes[n.id]?.state === "dim" ? "rgba(255,255,255,.06)" : "#d4ff3a")}
        />
        {replay && <Token replay={replay} v={v} graph={graph} />}
      </ReactFlow>
    </FlowCtx.Provider>
  );
}

function Token({ replay, v, graph }: { replay: Replay; v: number; graph: FlowGraph }) {
  const rf = useReactFlow();
  const { seg, frac } = segAt(replay, v);
  const center = (id: string) => {
    const n = rf.getInternalNode(id);
    if (!n) return null;
    const p = n.internals.positionAbsolute;
    return { x: p.x + (n.measured.width ?? 216) / 2, y: p.y + (n.measured.height ?? 92) / 2 };
  };
  let pos: { x: number; y: number } | null = null;
  if (seg.kind === "travel") {
    const el = seg.edge ? (document.querySelector(`[data-fp="${CSS.escape(seg.edge)}"]`) as SVGPathElement | null) : null;
    if (el) {
      const L = el.getTotalLength();
      const pt = el.getPointAtLength((seg.reverse ? 1 - frac : frac) * L);
      pos = { x: pt.x, y: pt.y };
    } else {
      const a = center(replay.hops[seg.hop].id);
      const b = center(replay.hops[seg.hop + 1]?.id ?? replay.hops[seg.hop].id);
      if (a && b) pos = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
    }
  } else {
    const c = center(replay.hops[seg.hop].id);
    // Đứng ở cạnh trên nút khi đang xử lý tại đó.
    if (c) pos = { x: c.x, y: c.y - 46 - 4 };
  }
  if (!pos) return null;
  const node = graph.nodes.find((n) => n.id === replay.hops[seg.hop].id);
  const t = realAt(replay, v) - replay.start;
  return (
    <ViewportPortal>
      <div className="fl-token" style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}>
        <i />
        <span>
          {seg.kind === "dwell" && node ? `${node.title} · ` : ""}
          {formatMs(Math.round(t))}
        </span>
      </div>
    </ViewportPortal>
  );
}

// ───────── Thanh thời gian ─────────

const STAGE_COLOR: Record<string, string> = { queue: "#5c5c66", write: "#7c5cff", slot: "#ffc65c", gap: "#ff4fd8", engine: "#d4ff3a" };

function Scrubber({ trace, replay, v, setV }: { trace: JobTrace; replay: Replay; v: number; setV: (v: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const stages = traceStages(trace);
  const total = Math.max(1, replay.end - replay.start);
  const t = realAt(replay, v);
  const pct = ((t - replay.start) / total) * 100;
  const seek = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return;
    const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    setV(visualAt(replay, replay.start + f * total));
  };
  return (
    <div className="space-y-2.5">
      <div
        ref={bar}
        role="slider"
        tabIndex={0}
        aria-label="Dòng thời gian"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.round(t - replay.start)}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seek(e.clientX);
        }}
        onPointerMove={(e) => e.buttons === 1 && seek(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setV(Math.min(replay.vTotal, v + 0.3));
          if (e.key === "ArrowLeft") setV(Math.max(0, v - 0.3));
        }}
        className="relative h-9 cursor-pointer touch-none rounded-m1 bg-white/[.04] hairline"
      >
        {stages.map((s) => (
          <span
            key={s.key}
            className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-[6px] transition-opacity duration-300"
            style={{
              left: `${((s.start - replay.start) / total) * 100}%`,
              width: `max(3px, ${(s.ms / total) * 100}%)`,
              background: STAGE_COLOR[s.key],
              opacity: t >= s.start ? 0.95 : 0.3,
            }}
            title={`${s.label} ${formatMs(s.ms)}`}
          />
        ))}
        <span className="pointer-events-none absolute -top-1 -bottom-1 w-0.5 rounded-full bg-fg shadow-[0_0_10px_rgba(255,255,255,.8)]" style={{ left: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {stages.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 tabular-nums">
            <i className="h-2 w-2 rounded-full" style={{ background: STAGE_COLOR[s.key] }} />
            {s.label} <b className="font-semibold text-fg/90">{formatMs(s.ms)}</b>
          </span>
        ))}
        <span className="ml-auto tabular-nums">
          Tổng <b className="font-semibold text-fg">{formatMs(total)}</b>
        </span>
      </div>
    </div>
  );
}

function JobChips({ job, trace }: { job: FlowJob; trace: JobTrace }) {
  const w = trace.writer;
  const e = trace.engine;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={job.status === "FAILED" ? "danger" : job.status === "SUCCEEDED" ? "ok" : "info"} dot>
        {job.kind === "VIDEO" ? "Video" : job.kind === "IMAGE" ? "Ảnh" : (job.kind ?? "Job")}
      </Badge>
      {trace.router && (
        <Badge tone="info">
          <Icon name="wand" size={11} />
          {trace.router.method === "ai" ? "AI chọn" : "Luật"} · {trace.router.chosen ?? "—"}
          {trace.router.candidates?.length ? ` / ${trace.router.candidates.length}` : ""}
        </Badge>
      )}
      {w && (
        <Badge tone="aura">
          <Icon name="sparkle" size={11} />
          {[w.provider, w.model].filter(Boolean).join(" · ")}
          {w.skill ? ` · ${w.skill}` : ""}
        </Badge>
      )}
      {w?.cache && <Badge tone="accent">cache</Badge>}
      {trace.guard?.fixes && trace.guard.fixes.length > 0 && (
        <Badge tone="ok">
          <Icon name="shield" size={11} />
          {trace.guard.fixes.length} sửa
        </Badge>
      )}
      {e && (
        <Badge>
          <Icon name="cpu" size={11} />
          {[e.provider, e.model, e.account].filter(Boolean).join(" · ")}
        </Badge>
      )}
      {trace.error && <Badge tone="danger">{jobErrorText(trace.error)}</Badge>}
    </div>
  );
}

// ───────── Trang ─────────

export function FlowView({ demo = false }: { demo?: boolean }) {
  const reduced = useReducedMotion();
  const [tab, setTab] = useState<Tab>("media");
  const [mode, setMode] = useState<"live" | "replay">("live");
  const live = usePoll<FlowData>(demo ? null : "/api/admin/flow", 3000);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!demo) return;
    const t = setInterval(() => !document.hidden && setTick((x) => x + 1), 3000);
    return () => clearInterval(t);
  }, [demo]);
  const data = useMemo(() => (demo ? demoFlow(tick) : live.data), [demo, tick, live.data]);
  const missing = !demo && (live.status === 404 || live.status === 405);

  // Planner Story theo cấu hình ai_roles.
  const [planners, setPlanners] = useState<{ provider: string; model?: string }[]>([]);
  useEffect(() => {
    if (tab !== "story" || planners.length) return;
    if (demo) return setPlanners(demoAi().roles?.story?.chain ?? []);
    api<AiData>("/api/admin/ai")
      .then((r) => setPlanners(r.roles?.story?.chain ?? []))
      .catch(() => setPlanners([{ provider: "muse", model: "muse-chat" }]));
  }, [tab, demo, planners.length]);

  const graph: FlowGraph | null = useMemo(() => {
    if (tab === "story") return withUi(storyGraph(data, planners.map((p) => ({ provider: p.provider, model: p.model ?? (p.provider === "muse" ? "muse-chat" : null) }))));
    return data?.nodes?.length ? withUi({ nodes: data.nodes, edges: data.edges ?? [] }) : null;
  }, [tab, data, planners]);

  // ── Phát lại ──
  const [jobs, setJobs] = useState<FlowJob[] | null>(null);
  const [jobId, setJobId] = useState("");
  const [trace, setTrace] = useState<JobTrace | null>(null);
  const [traceErr, setTraceErr] = useState<string | null>(null);
  const [v, setV] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (mode !== "replay" || jobs) return;
    if (demo) return setJobs(demoJobs());
    api<unknown>("/api/admin/flow/jobs?limit=20", { cache: "no-store" })
      .then((r) => setJobs(toJobs(r)))
      .catch(() => setJobs([]));
  }, [mode, demo, jobs]);

  const tabJobs = useMemo(() => (jobs ?? []).filter((j) => (tab === "story" ? Boolean(j.storyId) : !j.storyId)), [jobs, tab]);
  useEffect(() => {
    if (mode === "replay" && tabJobs.length && !tabJobs.some((j) => j.id === jobId)) setJobId(tabJobs[0].id);
  }, [mode, tabJobs, jobId]);
  const job = tabJobs.find((j) => j.id === jobId);

  useEffect(() => {
    setTrace(null);
    setTraceErr(null);
    if (!job) return;
    const inline = toTrace(job.trace);
    if (inline) return setTrace(inline);
    let off = false;
    api<unknown>(`/api/admin/jobs/${encodeURIComponent(job.id)}/trace`, { cache: "no-store" })
      .then((r) => !off && (toTrace(r) ? setTrace(toTrace(r)) : setTraceErr("Job chưa có trace")))
      .catch((e) => !off && setTraceErr(isNotFound(e) ? "Job chưa có trace" : (e as Error).message));
    return () => {
      off = true;
    };
  }, [job]);

  const replay = useMemo(() => (mode === "replay" && graph && job && trace ? buildReplay(graph, tab, job, trace) : null), [mode, graph, job, trace, tab]);
  useEffect(() => {
    setV(0);
    setPlaying(Boolean(replay));
  }, [replay]);

  useEffect(() => {
    if (!playing || !replay) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let stop = false;
      setV((x) => {
        const n = x + dt * speed;
        if (n >= replay.vTotal) {
          stop = true;
          return replay.vTotal;
        }
        return n;
      });
      if (stop) setPlaying(false);
      else raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, replay, speed]);

  // ── Trạng thái hiển thị ──
  const pos = replay ? segAt(replay, v) : null;
  const posKey = pos ? `${pos.seg.hop}:${pos.seg.kind}` : "";
  const visual: FlowVisual = useMemo(() => {
    const nodes: Record<string, NodeLive> = {};
    const edges: Record<string, EdgeVisual> = {};
    if (!graph) return { nodes, edges, reduced, replay: false };
    if (replay && pos && trace) {
      const cur = pos.seg.hop;
      const traveling = pos.seg.kind === "travel";
      replay.hops.forEach((h, i) => {
        const n = graph.nodes.find((x) => x.id === h.id);
        const done = i < cur || (i === cur && traveling);
        const st: NodeLive = { state: i === cur && !traveling ? (replay.failedAt === h.id && v >= replay.vTotal - 0.01 ? "failed" : "current") : done ? "visited" : "path" };
        if (n?.kind === "writer" && trace.writer) {
          st.ai = { provider: trace.writer.provider, model: trace.writer.model ?? undefined };
          if (trace.writer.cache) st.badge = "cache";
          if (done && trace.writeStart !== undefined && trace.writeEnd !== undefined) st.note = `${formatMs(trace.writeEnd - trace.writeStart - (trace.router?.method === "ai" ? (trace.router.ms ?? 0) : 0))}${trace.writer.skill ? ` · ${trace.writer.skill}` : ""}`;
        }
        if (n?.kind === "router" && trace.router) {
          st.note = `${trace.router.candidates?.length ?? "?"} → ${trace.router.chosen ?? "?"}${trace.router.ms ? ` · ${formatMs(trace.router.ms)}` : ""}`;
        }
        if (n?.kind === "skill" && trace.router?.candidates) st.note = `${trace.router.candidates.length} ứng viên`;
        if (n?.kind === "guard" && trace.guard) st.note = trace.guard.fixes?.length ? `${trace.guard.fixes.length} sửa: ${trace.guard.fixes[0]}` : "Không cần sửa";
        if ((n?.kind === "executor" || n?.kind === "shot") && trace.engine) {
          st.ai = { provider: trace.engine.provider, model: trace.engine.model ?? undefined, account: trace.engine.account ?? n.ai?.account };
          if (done && trace.doneAt && (trace.submitAt ?? trace.slotAt)) st.note = `Engine ${formatMs(trace.doneAt - (trace.submitAt ?? trace.slotAt)!)}`;
        }
        if (n?.kind === "muse-tab" && trace.engine?.account) st.ai = { provider: "muse", account: trace.engine.account };
        nodes[h.id] = st;
        if (i > 0) {
          const prev = replay.hops[i - 1].id;
          const id = [`${prev}->${h.id}`, `${h.id}->${prev}`].find((x) => graph.edges.some((e) => `${e.from}->${e.to}` === x));
          if (id) edges[id] = i < cur || (i === cur && !traveling) ? "visited" : i === cur + 1 && traveling ? "active" : "path";
        }
      });
      for (const n of graph.nodes) if (!nodes[n.id]) nodes[n.id] = { state: "dim" };
      return { nodes, edges, reduced, replay: true };
    }
    const counts = mode === "live" ? liveCounts(graph.nodes, data?.live?.activeJobs) : {};
    for (const n of graph.nodes) {
      const c = counts[n.id] ?? 0;
      const statActive = Number(n.stats?.active ?? 0);
      if (c > 0 || statActive > 0) nodes[n.id] = { state: "active", count: c || undefined };
    }
    for (const e of graph.edges) if (nodes[e.to]?.state === "active") edges[`${e.from}->${e.to}`] = "active";
    return { nodes, edges, reduced, replay: false };
    // pos chỉ đổi theo chặng (posKey), không theo từng khung hình.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, replay, posKey, trace, mode, data?.live, reduced, v >= (replay?.vTotal ?? Infinity) - 0.01]);

  const [open, setOpen] = useState<FlowNode | null>(null);
  const onOpen = useCallback((n: FlowNode) => setOpen(n), []);
  const activeCount = data?.live?.activeJobs?.length ?? 0;
  const hop = open && replay ? replay.hops.find((h) => h.id === open.id) : undefined;
  const openLive = open ? visual.nodes[open.id] : undefined;
  const openAi = openLive?.ai ?? open?.ai;

  return (
    <div className="am-flow space-y-3">
      <PageHeader
        icon="route"
        title="Luồng xử lý"
        sub={
          demo ? (
            <Badge tone="info">Demo</Badge>
          ) : missing ? (
            <span className="text-warn">API chưa sẵn sàng</span>
          ) : (
            <span className="inline-flex items-center gap-3">
              <LiveDot at={live.at} />
              {activeCount > 0 && <span className="text-xs text-fg/80 tabular-nums">{activeCount} job đang chạy</span>}
            </span>
          )
        }
        actions={
          <>
            <Segmented size="sm" ariaLabel="Luồng" value={tab} onChange={setTab} options={[{ value: "media", label: "Ảnh / Video" }, { value: "story", label: "Story" }]} />
            <Segmented
              size="sm"
              ariaLabel="Chế độ"
              value={mode}
              onChange={(m) => {
                setMode(m);
                setPlaying(false);
              }}
              options={[
                { value: "live", label: <><span className="h-1.5 w-1.5 rounded-full bg-ok" />Trực tiếp</> },
                { value: "replay", label: <><Icon name="play" size={12} />Phát lại</> },
              ]}
            />
          </>
        }
      />

      {mode === "replay" && (
        <div className="flex flex-wrap items-center gap-2 rounded-m3 bg-s1 p-2.5 hairline">
          <Select inputSize="sm" aria-label="Job" className="min-w-0 flex-1 basis-64" value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={!tabJobs.length}>
            {jobs === null ? (
              <option>Đang tải…</option>
            ) : tabJobs.length === 0 ? (
              <option>Chưa có job có trace</option>
            ) : (
              tabJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.kind === "VIDEO" ? "Video" : "Ảnh"} · {(j.prompt ?? j.id).slice(0, 60)}
                  {j.createdAt ? ` · ${timeAgo(j.createdAt)}` : ""}
                  {j.status === "FAILED" ? " · lỗi" : ""}
                </option>
              ))
            )}
          </Select>
          <IconButton icon={playing ? "pause" : "play"} label={playing ? "Dừng" : "Phát"} variant="subtle" size="sm" disabled={!replay} onClick={() => (replay && v >= replay.vTotal ? (setV(0), setPlaying(true)) : setPlaying((p) => !p))} />
          <IconButton icon="refresh" label="Phát lại từ đầu" variant="ghost" size="sm" disabled={!replay} onClick={() => (setV(0), setPlaying(true))} />
          <Segmented size="sm" ariaLabel="Tốc độ" value={speed} onChange={setSpeed} options={[1, 2, 4].map((s) => ({ value: s, label: `${s}×` }))} />
        </div>
      )}

      {missing && !demo && (
        <Notice tone="info">
          Backend chưa có <code className="font-mono text-[12.5px]">/api/admin/flow</code>. Xem bản minh họa:{" "}
          <a href="?demo=1" className="font-semibold text-accent underline-offset-2 hover:underline">
            ?demo=1
          </a>
        </Notice>
      )}

      <div className="relative h-[calc(100dvh-250px)] min-h-[520px] overflow-hidden rounded-m3 bg-[radial-gradient(120%_80%_at_20%_0%,rgba(124,92,255,.08),transparent_60%),radial-gradient(90%_70%_at_100%_100%,rgba(255,79,216,.06),transparent_60%)] bg-s1 hairline">
        {graph ? (
          <ReactFlowProvider key={tab}>
            <Canvas graph={graph} tab={tab} visual={visual} onOpen={onOpen} replay={replay} v={v} />
          </ReactFlowProvider>
        ) : live.loading && !demo ? (
          <div className="grid h-full grid-cols-4 content-center gap-6 p-10">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} aura className="h-24 rounded-m2" />
            ))}
          </div>
        ) : (
          <Empty icon="route" title="Chưa có dữ liệu luồng" hint={live.error && !missing ? live.error : "Khi backend có /api/admin/flow, sơ đồ hiện ở đây."} className="h-full" />
        )}
      </div>

      {mode === "replay" && (
        <div className={cx("rounded-m3 bg-s1 p-4 hairline transition-opacity duration-300", !replay && "opacity-70")}>
          {job && trace && replay ? (
            <div className="space-y-3.5">
              <JobChips job={job} trace={trace} />
              <Scrubber trace={trace} replay={replay} v={v} setV={(x) => (setPlaying(false), setV(x))} />
            </div>
          ) : (
            <p className="text-sm text-muted">{traceErr ?? (tabJobs.length ? "Đang tải trace…" : "Chọn job để phát lại đường đi thật")}</p>
          )}
        </div>
      )}

      <Drawer
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        size="sm"
        title={open?.title}
        subtitle={open ? (roleOf(open) ?? open.subtitle) : undefined}
      >
        {open && (
          <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-fg/85">{DESC[open.kind] ?? open.subtitle}</p>
            {openAi && (
              <div className="space-y-2">
                <h3 className="t-label">AI</h3>
                <KV
                  items={[
                    ["Provider", openAi.provider],
                    ...(openAi.model ? ([["Model", <span key="m" className="font-mono text-[12.5px]">{openAi.model}</span>]] as [React.ReactNode, React.ReactNode][]) : []),
                    ...(openAi.account ? ([["Tài khoản", openAi.account]] as [React.ReactNode, React.ReactNode][]) : []),
                  ]}
                />
              </div>
            )}
            {open.stats && Object.keys(open.stats).length > 0 && (
              <div className="space-y-2">
                <h3 className="t-label">Số liệu</h3>
                <KV items={Object.entries(open.stats).map(([k, val]) => [k, <span key={k} className="tabular-nums">{String(val ?? "—")}</span>])} />
              </div>
            )}
            {hop && replay && (
              <div className="space-y-2">
                <h3 className="t-label">Job này</h3>
                <KV
                  items={[
                    ["Tới lúc", `+${formatMs(hop.arrive - replay.start)}`],
                    ["Ở lại", formatMs(hop.leave - hop.arrive)],
                    ...(openLive?.note ? ([["Ghi chú", openLive.note]] as [React.ReactNode, React.ReactNode][]) : []),
                  ]}
                />
                {open.kind === "guard" && trace?.guard?.fixes && trace.guard.fixes.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[13px] text-fg/85">
                    {trace.guard.fixes.map((f) => (
                      <li key={f} className="flex gap-2">
                        <Icon name="check" size={14} className="mt-0.5 shrink-0 text-ok" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                {(open.kind === "router" || open.kind === "skill") && trace?.router?.candidates && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {trace.router.candidates.map((c) => (
                      <Badge key={c} tone={c === trace.router?.chosen ? "accent" : "neutral"}>
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}
            {LINKS[open.kind] && (
              <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                {LINKS[open.kind].map((l) => (
                  <LinkButton key={l.href} href={l.href} size="sm" variant="outline" iconRight="arrowRight">
                    {l.label}
                  </LinkButton>
                ))}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
