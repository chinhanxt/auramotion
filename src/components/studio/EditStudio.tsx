"use client";

import { useEffect, useMemo, useState } from "react";
import type { TileAction } from "@/components/library/JobTile";
import { useJobFeed } from "@/components/library/useJobFeed";
import { useCreditBalance } from "@/components/realtime/Events";
import { Empty, Notice } from "@/components/ui/Bits";
import { Switch } from "@/components/ui/Controls";
import { Dock } from "@/components/ui/Dock";
import { cx } from "@/components/ui/cx";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api, planLabel, postJson, ratioCss, type Catalog, type JobItem } from "@/lib/api-client";
import { ClipPicker, type PickedClip } from "./ClipPicker";
import { ClipInspector, ClipStrip, MAX_CLIPS, clipError, clipSeconds, moveItem, type TimelineClip } from "./ClipTimeline";
import { GenerateButton, RatioShape } from "./Composer";
import { describeError, toApiError, useErrorToast } from "./errors";
import { GenerationFeed } from "./GenerationFeed";
import { MusicPicker } from "./MusicPicker";
import { ScriptEditor, scriptError, splitLines } from "./ScriptEditor";
import { VoicePicker, type VoiceValue } from "./VoicePicker";
import { EditSkeleton } from "./EditSkeleton";

type SavedClip = { jobId: string; index?: number; in?: number; out?: number; duration?: number };
type SavedParams = {
  kind: string;
  aspect?: string;
  clips?: SavedClip[];
  lines?: string[];
  voice?: VoiceValue;
  musicId?: string;
  subtitles?: boolean;
  keepClipAudio?: boolean;
};

const QUOTE_DEBOUNCE_MS = 300;
const EDIT_ACTIONS: TileAction[] = ["download", "remake", "delete"];
const DEFAULT_IMAGE_SEC = 3;

let clipSeq = 0;
function toTimeline(c: PickedClip, saved: SavedClip = { jobId: c.jobId }): TimelineClip {
  return {
    ...c,
    key: `${c.jobId}-${c.index}-${++clipSeq}`,
    duration: saved.duration ?? DEFAULT_IMAGE_SEC,
    in: saved.in ?? 0,
    out: saved.out ?? null,
  };
}

// Dựng lại timeline từ tham số job cũ: bỏ clip không còn (đã xóa / hết hạn).
async function restoreClips(saved: SavedClip[]): Promise<TimelineClip[]> {
  const ids = [...new Set(saved.map((c) => c.jobId))];
  if (ids.length === 0) return [];
  const { items } = await api<{ items: JobItem[] }>(`/api/jobs?ids=${ids.map(encodeURIComponent).join(",")}`);
  const byId = new Map(items.map((j) => [j.id, j]));
  return saved.flatMap((c) => {
    const job = byId.get(c.jobId);
    const index = c.index ?? 0;
    const url = job?.status === "SUCCEEDED" ? job.resultUrls[index] : undefined;
    if (!job || !url || job.kind === "ASSEMBLE") return [];
    return [toTimeline({ jobId: job.id, index, kind: job.kind === "IMAGE" ? "image" : "video", url }, c)];
  });
}

type Panel = "clip" | "script" | "voice" | "audio";
const PANELS: { value: Panel; label: string; icon: IconName }[] = [
  { value: "clip", label: "Clip", icon: "film" },
  { value: "script", label: "Lời", icon: "text" },
  { value: "voice", label: "Giọng", icon: "mic" },
  { value: "audio", label: "Nhạc", icon: "music" },
];

export default function EditStudio({ fromJobId }: { fromJobId?: string }) {
  const toast = useToast();
  const showError = useErrorToast();
  const { refresh: refreshCredit } = useCreditBalance();
  const feed = useJobFeed({ kind: "assemble" });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [aspect, setAspect] = useState("9:16");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<VoiceValue>({});
  const [musicId, setMusicId] = useState("");
  const [subtitles, setSubtitles] = useState(true);
  const [keepClipAudio, setKeepClipAudio] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>("clip");
  const [bin, setBin] = useState(false);

  const model = catalog?.models.find((m) => !m.locked) ?? catalog?.models[0];
  const lines = splitLines(script);
  const linesError = scriptError(script);
  const sel = clips.find((c) => c.key === selected) ?? null;
  const selIndex = sel ? clips.indexOf(sel) : -1;
  const preview = sel ?? clips[0] ?? null;
  const total = useMemo(() => clips.reduce((s, c) => s + clipSeconds(c), 0), [clips]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cat, saved] = await Promise.all([
          api<Catalog>("/api/catalog?kind=assemble"),
          fromJobId ? api<SavedParams>(`/api/jobs/${encodeURIComponent(fromJobId)}/params`).catch(() => null) : null,
        ]);
        if (cancelled) return;
        const ratios = cat.models[0]?.options.aspectRatios ?? [];
        if (saved?.kind === "assemble") {
          const restored = await restoreClips(saved.clips ?? []).catch(() => [] as TimelineClip[]);
          if (cancelled) return;
          const notes: string[] = [];
          if (restored.length < (saved.clips?.length ?? 0)) notes.push("Một số clip cũ không còn, đã bỏ khỏi timeline");
          let savedVoice = saved.voice ?? {};
          if (savedVoice.refUrl && cat.plan.rank < 1) {
            savedVoice = {};
            notes.push("Giọng của tôi cần gói Pro, đã chuyển về giọng có sẵn");
          }
          const savedMusic = saved.musicId && cat.music?.some((t) => t.id === saved.musicId) ? saved.musicId : "";
          if (saved.musicId && !savedMusic) notes.push("Bài nhạc cũ không còn");
          setClips(restored);
          setSelected(restored[0]?.key ?? null);
          if (saved.aspect && ratios.includes(saved.aspect)) setAspect(saved.aspect);
          setScript((saved.lines ?? []).join("\n"));
          setVoice(savedVoice);
          setMusicId(savedMusic);
          setSubtitles(saved.subtitles ?? true);
          setKeepClipAudio(saved.keepClipAudio ?? false);
          notes.forEach((n) => toast.info(n));
        } else {
          if (!ratios.includes("9:16") && ratios[0]) setAspect(ratios[0]);
          if (fromJobId) toast.error("Không tải được thiết lập cũ");
        }
        setCatalog(cat);
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ nạp một lần theo job gốc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJobId]);

  // Giá chỉ phụ thuộc số câu: gửi clip / câu tạm để báo giá được khi chưa chọn gì.
  const lineCount = lines.length;
  useEffect(() => {
    if (!model || linesError) {
      setCost(null);
      return;
    }
    const controller = new AbortController();
    setQuoting(true);
    setCost(null);
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await postJson<{ cost: number }>(
          "/api/jobs/quote",
          {
            kind: "assemble",
            modelId: model.id,
            aspect,
            clips: [{ jobId: "-" }],
            lines: Array.from({ length: lineCount }, () => "-"),
            subtitles: true,
            keepClipAudio: false,
          },
          controller.signal,
        );
        setCost(res.cost);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setQuoteError(toApiError(err));
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [model?.id, aspect, lineCount, linesError, model]);

  function addClip(c: PickedClip, at = clips.length) {
    if (clips.length >= MAX_CLIPS) return toast.error(`Tối đa ${MAX_CLIPS} clip`);
    const t = toTimeline(c);
    setClips((list) => [...list.slice(0, at), t, ...list.slice(at)]);
    setSelected(t.key);
    setPanel("clip");
  }

  const needVoice = lines.length > 0 && !voice.preset && !voice.refUrl;
  const blocker = model?.locked
    ? `Ghép video cần gói ${planLabel(model.minPlanRank)}`
    : clips.length === 0
      ? "Thêm ít nhất 1 clip"
      : clips.some((c) => clipError(c))
        ? "Sửa thông số clip"
        : linesError
          ? linesError
          : needVoice
            ? "Chọn giọng đọc"
            : "";

  async function submit() {
    if (!model || blocker || submitting) return;
    setSubmitting(true);
    try {
      const job = await postJson<JobItem>("/api/jobs", {
        kind: "assemble",
        modelId: model.id,
        aspect,
        clips: clips.map((c) =>
          c.kind === "image"
            ? { jobId: c.jobId, index: c.index, duration: c.duration }
            : { jobId: c.jobId, index: c.index, in: c.in, ...(c.out !== null ? { out: c.out } : {}) },
        ),
        lines,
        ...(lines.length > 0 ? { voice: voice.refUrl ? { refUrl: voice.refUrl } : { preset: voice.preset } } : {}),
        ...(musicId ? { musicId } : {}),
        subtitles,
        keepClipAudio,
      });
      feed.prepend({ ...job, resultUrls: job.resultUrls ?? [], params: job.params ?? { aspect } });
      refreshCredit();
      toast.success("Đã gửi tác vụ ghép", { body: "Video sẽ hiện ở mục bên dưới" });
    } catch (err) {
      showError(err, model.minPlanRank);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <Notice tone="danger">{loadError}</Notice>;
  if (!catalog) return <EditSkeleton />;
  if (!model) return <Empty icon="cut" title="Tính năng ghép video đang tạm tắt" className="min-h-[50vh]" />;

  const ratios = model.options.aspectRatios ?? [];
  const quoteMsg = quoteError ? describeError(quoteError, model.minPlanRank) : null;

  const panels: Record<Panel, React.ReactNode> = {
    clip: sel ? (
      <ClipInspector
        clip={sel}
        index={selIndex}
        count={clips.length}
        onPatch={(patch) => setClips((l) => l.map((c) => (c.key === sel.key ? { ...c, ...patch } : c)))}
        onMove={(to) => setClips((l) => moveItem(l, selIndex, to))}
        onRemove={() => {
          setClips((l) => l.filter((c) => c.key !== sel.key));
          setSelected(clips[selIndex + 1]?.key ?? clips[selIndex - 1]?.key ?? null);
        }}
      />
    ) : (
      <p className="py-6 text-center text-sm text-muted">Chọn một clip trên timeline để chỉnh</p>
    ),
    script: <ScriptEditor value={script} onChange={setScript} onBusyChange={setAiBusy} voice={voice} />,
    voice: <VoicePicker value={voice} onChange={setVoice} planRank={catalog.plan.rank} onBusyChange={setVoiceBusy} />,
    audio: (
      <div className="space-y-4">
        <MusicPicker tracks={catalog.music ?? []} value={musicId} onChange={setMusicId} />
        <div className="space-y-1 border-t border-line pt-3">
          <Switch checked={subtitles} onChange={setSubtitles} label="Phụ đề" icon="subtitles" />
          <Switch checked={keepClipAudio} onChange={setKeepClipAudio} label="Giữ tiếng gốc của clip" icon="volume" />
        </div>
      </div>
    ),
  };

  return (
    <div className="pb-[calc(96px+var(--tabbar-h))]">
      <div className="px-3 pt-3 sm:px-5 lg:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h1 className="t-h2">Ghép</h1>
          {ratios.length > 0 && (
            <Segmented size="sm" ariaLabel="Tỷ lệ khung" options={ratios.map((r) => ({ value: r, label: <><RatioShape ratio={r} size={12} />{r}</> }))} value={aspect} onChange={setAspect} />
          )}
        </div>

        <div className="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)_360px] xl:grid-cols-[320px_minmax(0,1fr)_380px]">
          {/* Kho clip */}
          <aside className="hidden max-h-[calc(100dvh-300px)] min-h-[420px] overflow-y-auto rounded-m3 bg-s1 p-3 hairline lg:block">
            <p className="t-label mb-3 px-1">Kho</p>
            <ClipPicker onAdd={(c) => addClip(c)} columns="grid-cols-3" />
          </aside>

          {/* Xem trước */}
          <section className="relative flex items-center justify-center overflow-hidden rounded-m3 bg-[#050506] p-4 pt-14 hairline lg:min-h-[420px] lg:pt-4">
            <div className="relative max-h-[52dvh] overflow-hidden rounded-m2 bg-s2 shadow-2xl" style={{ aspectRatio: ratioCss(aspect), height: "clamp(220px, 40dvh, 560px)", maxWidth: "100%" }}>
              {preview ? (
                preview.kind === "image" ? (
                  <img key={preview.key} src={preview.url} alt="" className="blur-in h-full w-full object-cover" />
                ) : (
                  <video key={preview.key} src={`${preview.url}#t=${preview.in}`} muted loop autoPlay playsInline className="blur-in h-full w-full object-cover" />
                )
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
                  <Icon name="film" size={26} />
                  <span className="text-sm">Thêm clip để xem trước</span>
                </div>
              )}
              {subtitles && lines[0] && (
                <span className="absolute inset-x-3 bottom-[12%] text-center text-[13px] leading-snug font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9)]">{lines[0]}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setBin(true)}
              className="press glass absolute top-3 left-3 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hairline lg:hidden"
            >
              <Icon name="plus" size={16} /> Kho clip
            </button>
          </section>

          {/* Bảng chỉnh */}
          <aside className="rounded-m3 bg-s1 p-3 hairline lg:max-h-[calc(100dvh-300px)] lg:min-h-[420px] lg:overflow-y-auto">
            <Segmented
              block
              size="sm"
              ariaLabel="Bảng chỉnh"
              options={PANELS.map((p) => ({
                value: p.value,
                label: (
                  <>
                    <Icon name={p.icon} size={14} />
                    {p.label}
                    {p.value === "script" && lines.length > 0 && <span className="text-[10px] text-muted tabular-nums">{lines.length}</span>}
                  </>
                ),
              }))}
              value={panel}
              onChange={setPanel}
            />
            {PANELS.map((p) => (
              <div key={p.value} hidden={p.value !== panel} className="page-enter mt-4 px-1">
                {panels[p.value]}
              </div>
            ))}
          </aside>
        </div>

        <div className="mt-3">
          <ClipStrip clips={clips} selected={selected} onSelect={(k) => (setSelected(k), setPanel("clip"))} onChange={setClips} onDropNew={addClip} onAddClick={() => setBin(true)} />
        </div>

        <h2 className="t-label mt-10 mb-3">Video đã ghép</h2>
        <GenerationFeed feed={feed} actions={EDIT_ACTIONS} skeletonRatio="9:16" empty={<Empty icon="cut" title="Chưa có video ghép" className="py-10" />} />
      </div>

      {/* Thanh xuất */}
      <Dock>
        <div className="pointer-events-auto mx-auto flex max-w-[1040px] items-center gap-3 rounded-m3 glass-strong p-2 pl-4 shadow-[0_0_0_1px_var(--color-line2),0_24px_60px_-20px_rgba(0,0,0,.9)]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {clips.length} clip · ~{Math.round(total)}s{lines.length > 0 && ` · ${lines.length} câu`}
              {musicId && " · nhạc"}
            </p>
            <p className={cx("truncate text-xs", blocker || quoteMsg ? "text-warn" : "text-muted")}>{blocker || quoteMsg?.title || `${aspect} · ${subtitles ? "có phụ đề" : "không phụ đề"}`}</p>
          </div>
          <GenerateButton
            type="button"
            label="Xuất"
            onClick={submit}
            cost={cost}
            quoting={quoting}
            pending={submitting}
            disabled={model.locked || blocker !== "" || voiceBusy || aiBusy}
          />
        </div>
      </Dock>

      <Modal open={bin} onClose={() => setBin(false)} title="Kho clip" size="lg">
        <ClipPicker
          onAdd={(c) => {
            addClip(c);
            toast.success("Đã thêm vào timeline", { duration: 1600 });
          }}
          columns="grid-cols-3 sm:grid-cols-4 md:grid-cols-5"
        />
      </Modal>
    </div>
  );
}
