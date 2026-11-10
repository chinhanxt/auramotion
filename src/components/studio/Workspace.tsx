"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TileAction } from "@/components/library/JobTile";
import { useJobFeed } from "@/components/library/useJobFeed";
import { useCreditBalance } from "@/components/realtime/Events";
import { Empty, Notice } from "@/components/ui/Bits";
import { Dock } from "@/components/ui/Dock";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { ApiError, api, planLabel, postJson, type Catalog, type CatalogModel, type JobItem } from "@/lib/api-client";
import { AiWriteControl, AspectMenu, AutoTextarea, GenerateButton, RATIO_LABEL, RatioShape, ToolButton } from "./Composer";
import { ModelList, ModelPicker } from "./ModelPicker";
import { describeError, toApiError, useErrorToast } from "./errors";
import { GenerationFeed, JustifiedSkeleton } from "./GenerationFeed";
import { PresetCover, PresetGallery } from "./PresetGallery";
import { RefSlot } from "./RefSlot";
import { usePrewrite } from "./usePrewrite";

type Kind = "image" | "video";

type SavedParams = {
  kind: string;
  modelId?: string;
  prompt?: string;
  aspectRatio?: string;
  imageCount?: number;
  durationSec?: number;
  presetId?: string;
  inputUrl?: string;
  idea?: string;
  autoWrite?: boolean;
  skillId?: string;
};

// Chế độ "AI viết" + skill, nhớ theo từng loại (ảnh / video).
type WritePref = { on: boolean; skillId: string };
const prefKey = (kind: Kind) => `am:ai-write:${kind}`;
function readPref(kind: Kind): WritePref {
  try {
    const v = JSON.parse(localStorage.getItem(prefKey(kind)) ?? "null") as Partial<WritePref> | null;
    return { on: v?.on !== false, skillId: typeof v?.skillId === "string" ? v.skillId : "" };
  } catch {
    return { on: true, skillId: "" };
  }
}
function writePref(kind: Kind, pref: WritePref) {
  try {
    localStorage.setItem(prefKey(kind), JSON.stringify(pref));
  } catch {
    // trình duyệt chặn storage
  }
}

// Model đã chọn, nhớ theo từng loại.
const modelKey = (kind: Kind) => `am:model:${kind}`;
function readModel(kind: Kind): string {
  try {
    return localStorage.getItem(modelKey(kind)) ?? "";
  } catch {
    return "";
  }
}
function saveModel(kind: Kind, id: string) {
  try {
    localStorage.setItem(modelKey(kind), id);
  } catch {
    // trình duyệt chặn storage
  }
}

const QUOTE_DEBOUNCE_MS = 300;
const IMAGE_ACTIONS: TileAction[] = ["download", "ref", "frame", "remake", "delete"];
const VIDEO_ACTIONS: TileAction[] = ["download", "remake", "delete"];

const TEXT = {
  image: {
    title: "Ảnh",
    unit: "ảnh",
    placeholder: "Mô tả ảnh bạn muốn tạo…",
    autoPlaceholder: "Kể ý tưởng — AI viết prompt rồi tạo",
    preset: "Phong cách",
    ref: "Ảnh tham chiếu",
    empty: "Ảnh đầu tiên của bạn sẽ hiện ở đây",
    ideas: ["Chai nước hoa hổ phách trên bàn gỗ, nắng sớm", "Ly cà phê sữa đá, phố Sài Gòn mưa đêm", "Đôi giày trắng trên nền cát, bóng đổ dài"],
  },
  video: {
    title: "Video",
    unit: "5 giây",
    placeholder: "Mô tả chuyển động bạn muốn…",
    autoPlaceholder: "Kể ý tưởng chuyển động — AI viết prompt rồi tạo",
    preset: "Camera",
    ref: "Khung đầu",
    empty: "Video đầu tiên của bạn sẽ hiện ở đây",
    ideas: ["Chai nước hoa xoay chậm trên đá cẩm thạch", "Tà áo dài bay trong gió, hoàng hôn", "Hơi nước bốc lên từ tô phở, cận cảnh"],
  },
} as const;

function pick<T>(list: T[] | undefined, value: T | undefined, fallback: T): T {
  if (!list || list.length === 0) return fallback;
  return value !== undefined && list.includes(value) ? value : list[0];
}

export function Workspace({ kind, fromJobId, initialPrompt, initialFrame }: { kind: Kind; fromJobId?: string; initialPrompt?: string; initialFrame?: string }) {
  const text = TEXT[kind];
  const toast = useToast();
  const showError = useErrorToast();
  const { refresh: refreshCredit } = useCreditBalance();
  const feed = useJobFeed({ kind });

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [aspectRatio, setAspectRatio] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [durationSec, setDurationSec] = useState(5);
  const [presetId, setPresetId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [autoWrite, setAutoWrite] = useState(true);
  const pref = useRef<WritePref>({ on: true, skillId: "" });
  const [inputUrl, setInputUrl] = useState<string | null>(initialFrame ?? null);
  const [uploading, setUploading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [settings, setSettings] = useState(false);

  const model = useMemo(() => catalog?.models.find((m) => m.id === modelId), [catalog, modelId]);
  const maxDuration = catalog?.plan.maxDurationSec ?? 5;
  const preset = catalog?.presets.find((p) => p.id === presetId);
  const skills = useMemo(() => (catalog?.skills ?? []).filter((s) => s.kind === (kind === "image" ? "IMAGE" : "VIDEO")), [catalog, kind]);
  const videoBlocked = kind === "video" && catalog?.videoUnavailable === true;
  // Viết trước cùng tham số job sẽ gửi (Tạo → backend dùng cache).
  const prewrite = usePrewrite(
    autoWrite && catalog && aspectRatio
      ? {
          idea: prompt,
          kind,
          aspect: aspectRatio,
          ...(kind === "video" ? { durationSec } : {}),
          ...(skillId ? { skillId } : {}),
          ...(presetId ? (kind === "image" ? { styleId: presetId } : { cameraId: presetId }) : {}),
          hasRef: Boolean(inputUrl),
        }
      : null,
  );

  function applyModel(m: CatalogModel, maxDur: number, saved: { aspectRatio?: string; imageCount?: number; durationSec?: number } = {}) {
    setModelId(m.id);
    setAspectRatio((cur) => pick(m.options.aspectRatios, saved.aspectRatio ?? cur, ""));
    setImageCount((cur) => pick(m.options.counts, saved.imageCount ?? cur, 1));
    const durations = (m.options.durations ?? [5]).filter((d) => d <= maxDur);
    setDurationSec((cur) => pick(durations, saved.durationSec ?? cur, 5));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cat, saved] = await Promise.all([
          api<Catalog>(`/api/catalog?kind=${kind}`),
          fromJobId ? api<SavedParams>(`/api/jobs/${encodeURIComponent(fromJobId)}/params`).catch(() => null) : null,
        ]);
        if (cancelled) return;
        setCatalog(cat);
        const kindSkills = (cat.skills ?? []).filter((s) => s.kind === (kind === "image" ? "IMAGE" : "VIDEO") && !s.locked);
        const validSkill = (id?: string) => (id && kindSkills.some((s) => s.id === id) ? id : "");
        pref.current = readPref(kind);
        setAutoWrite(pref.current.on);
        setSkillId(validSkill(pref.current.skillId));
        const usable = cat.models.filter((m) => !m.locked);
        const fromSaved = saved?.kind === kind ? usable.find((m) => m.id === saved.modelId) : undefined;
        const remembered = usable.find((m) => m.id === readModel(kind));
        const first = fromSaved ?? remembered ?? usable[0];
        if (first) applyModel(first, cat.plan.maxDurationSec, saved?.kind === kind ? saved : {});
        if (saved?.kind === kind) {
          // Job do AI viết → nạp lại ý tưởng gốc + bật AI viết; job thủ công → nạp prompt, gửi nguyên văn (không ghi đè lựa chọn đã nhớ).
          const savedAuto = saved.autoWrite === true && Boolean(saved.idea?.trim());
          setPrompt(savedAuto ? (saved.idea ?? "") : (saved.prompt ?? ""));
          setAutoWrite(savedAuto);
          if (savedAuto && saved.skillId !== undefined) setSkillId(validSkill(saved.skillId));
          setPresetId(cat.presets.some((p) => p.id === saved.presetId) ? (saved.presetId ?? "") : "");
          setInputUrl(saved.inputUrl ?? null);
          if (!fromSaved && saved.modelId) toast.info("Model cũ không còn dùng được, đã chọn model khác");
        } else if (fromJobId && saved === null) {
          toast.error("Không tải được thiết lập cũ");
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ nạp một lần theo loại trang / job gốc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, fromJobId]);

  useEffect(() => {
    if (!modelId || !aspectRatio) return;
    const controller = new AbortController();
    setQuoting(true);
    setCost(null);
    setQuoteError(null);
    const timer = setTimeout(async () => {
      try {
        // Giá không phụ thuộc prompt; gửi prompt tạm khi ô còn trống.
        const params =
          kind === "image" ? { kind, modelId, prompt: "-", aspectRatio, imageCount } : { kind, modelId, prompt: "-", aspectRatio, durationSec };
        const res = await postJson<{ cost: number }>("/api/jobs/quote", params, controller.signal);
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
  }, [kind, modelId, aspectRatio, imageCount, durationSec]);

  // Ô trống lại sau khi tạm tắt (Viết vào ô / tạo lại job thủ công) → trở về chế độ đã nhớ.
  useEffect(() => {
    if (prompt.trim() === "" && pref.current.on) setAutoWrite(true);
  }, [prompt]);

  function onPickModel(m: CatalogModel) {
    applyModel(m, maxDuration);
    saveModel(kind, m.id);
  }

  function onToggleWrite(on: boolean) {
    setAutoWrite(on);
    pref.current = { ...pref.current, on };
    writePref(kind, pref.current);
  }

  function onSkill(id: string) {
    setSkillId(id);
    pref.current = { ...pref.current, skillId: id };
    writePref(kind, pref.current);
  }

  async function onAiWrite() {
    const idea = prompt.trim();
    if (!idea) return toast.info("Nhập ý tưởng vào ô trước");
    setAiWriting(true);
    try {
      const res = await postJson<{ prompt?: string; provider?: string }>("/api/ai/prompt", {
        idea,
        kind,
        ...(aspectRatio ? { aspect: aspectRatio } : {}),
        ...(kind === "video" ? { durationSec } : {}),
        ...(skillId ? { skillId } : {}),
        ...(presetId ? (kind === "image" ? { styleId: presetId } : { cameraId: presetId }) : {}),
      });
      if (res.prompt) {
        setPrompt(res.prompt);
        // Prompt đã nằm trong ô: Tạo sẽ gửi nguyên văn (không viết lại lần nữa).
        setAutoWrite(false);
        toast.success("AI đã viết prompt", { body: `${res.provider ? `${res.provider} · ` : ""}Sửa rồi bấm Tạo` });
      }
    } catch (err) {
      showError(err);
    } finally {
      setAiWriting(false);
    }
  }

  async function submit() {
    if (!model || !prompt.trim() || submitting || videoBlocked) return;
    setSubmitting(true);
    const raw = prompt.trim();
    const skill = autoWrite ? skills.find((s) => s.id === skillId) : undefined;
    try {
      const job = await postJson<JobItem>("/api/jobs", {
        kind,
        modelId,
        prompt: raw,
        aspectRatio,
        ...(kind === "image" ? { imageCount } : { durationSec }),
        ...(presetId ? { presetId } : {}),
        ...(inputUrl ? { inputUrl } : {}),
        ...(autoWrite ? { autoWrite: true, ...(skill ? { skillId: skill.id } : {}) } : {}),
      });
      const params: Record<string, unknown> = { ...(job.params ?? { aspectRatio, imageCount, durationSec }) };
      // Ô hiện "AI đang viết prompt…" ngay, kể cả khi backend chưa trả đủ params.
      if (autoWrite) {
        params.autoWrite ??= true;
        params.idea ??= raw;
        if (skill) params.skillName ??= skill.name;
      }
      feed.prepend({ ...job, resultUrls: job.resultUrls ?? [], params });
      refreshCredit();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      showError(err, model.minPlanRank);
    } finally {
      setSubmitting(false);
    }
  }

  const onUseRef = useCallback(
    (url: string) => {
      setInputUrl(url);
      toast.info("Đã đặt làm ảnh tham chiếu");
    },
    [toast],
  );

  const counts = model?.options.counts ?? [1];
  const durations = model?.options.durations ?? [5];
  const ratios = model?.options.aspectRatios ?? [];
  const quoteMsg = quoteError ? describeError(quoteError, model?.minPlanRank) : null;
  const canSubmit = Boolean(model) && !model?.locked && prompt.trim() !== "" && !uploading && !aiWriting && !videoBlocked;

  const countControl =
    kind === "image" && counts.length > 1 ? (
      <Segmented size="sm" ariaLabel="Số ảnh" options={counts.map((n) => ({ value: n, label: `×${n}` }))} value={imageCount} onChange={setImageCount} />
    ) : kind === "video" && durations.length > 0 ? (
      <Segmented
        size="sm"
        ariaLabel="Thời lượng"
        options={durations.map((d) => ({
          value: d,
          disabled: d > maxDuration,
          title: d > maxDuration ? `Cần gói ${planLabel(1)}` : undefined,
          label: (
            <>
              {d}s{d > maxDuration && <Icon name="lock" size={11} />}
            </>
          ),
        }))}
        value={durationSec}
        onChange={setDurationSec}
      />
    ) : null;

  const presetButton = catalog && catalog.presets.length > 0 && (
    <ToolButton onClick={() => setGallery(true)} active={Boolean(preset)} tip={text.preset} className="pl-1.5">
      {preset ? (
        <PresetCover preset={preset} className="h-6 w-6 rounded-[7px]" />
      ) : (
        <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-white/[.06]">
          <Icon name={kind === "image" ? "palette" : "camera"} size={15} />
        </span>
      )}
      <span className="max-w-28 truncate">{preset?.name ?? text.preset}</span>
    </ToolButton>
  );

  return (
    <div className="relative">
      <div className="px-3 pt-3 pb-[calc(220px+var(--tabbar-h))] sm:px-5 lg:px-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <h1 className="t-h2">{text.title}</h1>
          <Link href="/library" className="press inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-fg">
            Thư viện <Icon name="arrowRight" size={15} />
          </Link>
        </div>
        {loadError ? (
          <Notice tone="danger">{loadError}</Notice>
        ) : (
          <GenerationFeed
            feed={feed}
            skeletonRatio={kind === "image" ? "1:1" : "9:16"}
            actions={kind === "image" ? IMAGE_ACTIONS : VIDEO_ACTIONS}
            onUseRef={kind === "image" ? onUseRef : undefined}
            empty={
              <Empty
                icon={kind === "image" ? "image" : "video"}
                title={text.empty}
                className="min-h-[46vh]"
                action={
                  <div className="mt-2 flex max-w-xl flex-wrap justify-center gap-2">
                    {text.ideas.map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        onClick={() => setPrompt(idea)}
                        className="press rounded-full bg-white/[.05] px-3.5 py-2 text-[13px] text-fg/80 hairline hover:bg-white/[.09] hover:text-fg"
                      >
                        {idea}
                      </button>
                    ))}
                  </div>
                }
              />
            }
          />
        )}
      </div>

      {/* Composer nổi */}
      <Dock>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg via-bg/80 to-transparent" aria-hidden="true" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="composer pointer-events-auto relative mx-auto max-w-[1040px] rounded-m4 glass-strong px-3 pt-3 pb-2.5 shadow-[0_0_0_1px_var(--color-line2),0_30px_80px_-20px_rgba(0,0,0,.9)] sm:px-4 sm:pt-3 sm:pb-3"
        >
          {videoBlocked && (
            <Notice tone="warn" className="mb-2.5">
              Video Muse tạm không khả dụng
            </Notice>
          )}
          {!catalog && !loadError ? (
            <div className="flex items-center gap-3 p-1">
              <div className="skel h-14 w-14 rounded-m1" />
              <div className="flex-1 space-y-2">
                <div className="skel h-4 w-2/3 rounded-full" />
                <div className="skel h-8 w-full rounded-[11px]" />
              </div>
            </div>
          ) : catalog && catalog.models.length === 0 ? (
            <Notice tone="warn">Hiện chưa có model nào hoạt động.</Notice>
          ) : (
            <>
              <div className="flex items-start gap-3">
                <RefSlot value={inputUrl} onChange={setInputUrl} onBusyChange={setUploading} label={text.ref} />
                <AutoTextarea
                  value={prompt}
                  onChange={setPrompt}
                  placeholder={autoWrite ? text.autoPlaceholder : text.placeholder}
                  onSubmit={submit}
                  className="min-h-14 pt-1 pb-1 pr-0.5 sm:pt-1.5"
                  ariaLabel="Prompt"
                />
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                  <AiWriteControl
                    skills={skills}
                    skillId={skillId}
                    onSkill={onSkill}
                    on={autoWrite}
                    onToggle={onToggleWrite}
                    onWrite={onAiWrite}
                    pending={aiWriting}
                    prewrite={prewrite}
                    onUsePrewrite={(text) => {
                      setPrompt(text);
                      setAutoWrite(false);
                    }}
                  />
                  {/* Luồng: AI viết prompt → model người dùng chọn tạo kết quả */}
                  {catalog && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Icon name="arrowRight" size={14} className={cx("shrink-0 max-md:hidden", autoWrite ? "text-[#c9bdff]" : "text-dim")} />
                      <ModelPicker models={catalog.models} value={modelId} onChange={onPickModel} unit={text.unit} />
                    </div>
                  )}
                  {presetButton}
                  <div className="hidden items-center gap-1.5 md:flex">
                    <AspectMenu ratios={ratios} value={aspectRatio} onChange={setAspectRatio} />
                    {countControl}
                  </div>
                  <ToolButton onClick={() => setSettings(true)} className="md:hidden" aria-label="Thiết lập">
                    <Icon name="sliders" size={16} />
                    <span className="text-muted">{aspectRatio}</span>
                    <span className="text-muted">{kind === "image" ? `×${imageCount}` : `${durationSec}s`}</span>
                  </ToolButton>
                </div>
                {quoteMsg && (
                  <span className="hidden items-center gap-1.5 text-xs text-warn lg:inline-flex">
                    {quoteMsg.title}
                    {quoteMsg.action && (
                      <Link href={quoteMsg.action.href} className="underline underline-offset-2">
                        {quoteMsg.action.label}
                      </Link>
                    )}
                  </span>
                )}
                <GenerateButton cost={cost} quoting={quoting} pending={submitting} disabled={!canSubmit} />
              </div>
            </>
          )}
        </form>
      </Dock>

      {catalog && (
        <PresetGallery
          open={gallery}
          onClose={() => setGallery(false)}
          presets={catalog.presets}
          value={presetId}
          onChange={setPresetId}
          title={kind === "image" ? "Chọn phong cách" : "Chuyển động camera"}
        />
      )}

      <Modal open={settings} onClose={() => setSettings(false)} title="Thiết lập" size="sm">
        <div className="space-y-5">
          {ratios.length > 0 && (
            <div className="space-y-2">
              <p className="t-label">Tỷ lệ khung</p>
              <div className="grid grid-cols-4 gap-2">
                {ratios.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAspectRatio(r)}
                    className={cx(
                      "press flex flex-col items-center gap-1.5 rounded-m1 py-3 text-xs font-medium",
                      r === aspectRatio ? "bg-white/[.1] text-fg ring-1 ring-accent" : "bg-white/[.04] text-muted",
                    )}
                  >
                    <RatioShape ratio={r} size={20} />
                    {r}
                    <span className="text-[10px] text-dim">{RATIO_LABEL[r]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {countControl && (
            <div className="space-y-2">
              <p className="t-label">{kind === "image" ? "Số ảnh" : "Thời lượng"}</p>
              {countControl}
            </div>
          )}
          {catalog && catalog.models.length > 1 && (
            <div className="space-y-2">
              <p className="t-label">Model</p>
              <ModelList models={catalog.models} value={modelId} onPick={onPickModel} unit={text.unit} autoFocus={false} className="-mx-2.5 max-h-[44dvh]" />
            </div>
          )}
          {quoteMsg && <Notice tone="warn">{quoteMsg.title}</Notice>}
          <Button variant="primary" block onClick={() => setSettings(false)}>
            Xong
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export function WorkspaceSkeleton({ ratio }: { ratio: string }) {
  return (
    <div className="px-3 pt-3 sm:px-5 lg:px-6">
      <div className="mb-4 h-9 w-24 skel rounded-m1" />
      <JustifiedSkeleton ratio={ratio} count={10} />
    </div>
  );
}
