"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobGrid } from "@/components/library/JobGrid";
import { ApiError, api, planLabel, postJson, type Catalog, type JobItem } from "@/lib/api-client";
import { AspectRatioPicker } from "./AspectRatioPicker";
import { ClipPicker, type PickedClip } from "./ClipPicker";
import { ClipTimeline, MAX_CLIPS, clipError, type TimelineClip } from "./ClipTimeline";
import { ErrorNotice, toApiError } from "./GenerateForm";
import { GenerateButton } from "./GenerateButton";
import { MusicPicker } from "./MusicPicker";
import { ScriptEditor, scriptError, splitLines } from "./ScriptEditor";
import { VoicePicker, type VoiceValue } from "./VoicePicker";

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

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-neutral-700">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? "bg-neutral-900" : "bg-neutral-300"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
      </button>
    </label>
  );
}

// Dựng lại timeline từ tham số job cũ: bỏ clip không còn (đã xóa / hết hạn).
async function restoreClips(saved: SavedClip[]): Promise<TimelineClip[]> {
  const ids = [...new Set(saved.map((c) => c.jobId))];
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

export function AssembleForm({ fromJobId }: { fromJobId?: string }) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [clips, setClips] = useState<TimelineClip[]>([]);
  const [aspect, setAspect] = useState("9:16");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState<VoiceValue>({});
  const [musicId, setMusicId] = useState("");
  const [subtitles, setSubtitles] = useState(true);
  const [keepClipAudio, setKeepClipAudio] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const model = catalog?.models.find((m) => !m.locked) ?? catalog?.models[0];
  const lines = splitLines(script);
  const linesError = scriptError(script);

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
          if (saved.aspect && ratios.includes(saved.aspect)) setAspect(saved.aspect);
          setScript((saved.lines ?? []).join("\n"));
          setVoice(savedVoice);
          setMusicId(savedMusic);
          setSubtitles(saved.subtitles ?? true);
          setKeepClipAudio(saved.keepClipAudio ?? false);
          setNotice(notes.join(". "));
        } else {
          if (!ratios.includes("9:16") && ratios[0]) setAspect(ratios[0]);
          if (fromJobId) setNotice("Không tải được thiết lập cũ");
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
  }, [model?.id, aspect, lineCount, linesError]);

  function addClip(c: PickedClip) {
    setError(null);
    if (clips.length >= MAX_CLIPS) {
      setError(new ApiError("VALIDATION", `Tối đa ${MAX_CLIPS} clip`, 400));
      return;
    }
    setClips((list) => [...list, toTimeline(c)]);
  }

  const needVoice = lines.length > 0 && !voice.preset && !voice.refUrl;
  const blocker = model?.locked
    ? `Ghép video cần gói ${planLabel(model.minPlanRank)}`
    : clips.length === 0
      ? "Chọn ít nhất 1 clip"
      : clips.some((c) => clipError(c))
        ? "Sửa thông số clip trong thứ tự ghép"
        : linesError
          ? linesError
          : needVoice
            ? "Chọn giọng đọc"
            : "";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!model || blocker) return;
    setSubmitting(true);
    setError(null);
    setNotice("");
    try {
      await postJson("/api/jobs", {
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
      setNotice("Đã gửi tác vụ ghép. Video sẽ hiện ở mục gần đây và trong Thư viện (tab Video ghép).");
      setRefreshKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  if (!catalog) return <p className="text-sm text-neutral-500">Đang tải...</p>;
  if (!model) {
    return <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Tính năng ghép video đang tạm tắt.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,480px)_1fr]">
      <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-4 md:p-5">
        <ClipTimeline clips={clips} onChange={setClips} />
        <ClipPicker onAdd={addClip} />
        <AspectRatioPicker ratios={model.options.aspectRatios ?? []} value={aspect} onChange={setAspect} />
        <ScriptEditor value={script} onChange={setScript} onBusyChange={setAiBusy} />
        {lines.length > 0 && <VoicePicker value={voice} onChange={setVoice} planRank={catalog.plan.rank} onBusyChange={setVoiceBusy} />}
        <MusicPicker tracks={catalog.music ?? []} value={musicId} onChange={setMusicId} />
        <div className="space-y-3">
          <Toggle label="Phụ đề" checked={subtitles} onChange={setSubtitles} />
          <Toggle label="Giữ tiếng gốc của clip" checked={keepClipAudio} onChange={setKeepClipAudio} />
        </div>

        {(error ?? quoteError) && <ErrorNotice error={(error ?? quoteError) as ApiError} minRank={model.minPlanRank} />}
        {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
        {blocker && <p className="text-xs text-neutral-500">{blocker}</p>}
        <GenerateButton
          label="Ghép video"
          cost={cost}
          quoting={quoting}
          pending={submitting}
          disabled={model.locked || blocker !== "" || voiceBusy || aiBusy}
        />
      </form>

      <section className="min-w-0 space-y-3">
        <h2 className="text-base font-semibold">Video ghép gần đây</h2>
        <JobGrid fixedKind="assemble" refreshKey={refreshKey} />
      </section>
    </div>
  );
}
