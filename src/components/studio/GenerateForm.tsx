"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { JobGrid } from "@/components/library/JobGrid";
import { ApiError, api, planLabel, postJson, type Catalog, type CatalogModel } from "@/lib/api-client";
import { AspectRatioPicker } from "./AspectRatioPicker";
import { EngineSelect } from "./EngineSelect";
import { GenerateButton } from "./GenerateButton";
import { ImageUpload } from "./ImageUpload";
import { PresetPicker } from "./PresetPicker";
import { PromptBox } from "./PromptBox";

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
};

const QUOTE_DEBOUNCE_MS = 300;

const TEXT = {
  image: {
    unit: "ảnh",
    placeholder: "Mô tả ảnh bạn muốn tạo, ví dụ: chai nước hoa hổ phách trên bàn gỗ, ánh nắng sớm",
    preset: "Phong cách",
    upload: "Ảnh tham chiếu (không bắt buộc)",
    recent: "Ảnh gần đây",
  },
  video: {
    unit: "5 giây",
    placeholder: "Mô tả video bạn muốn tạo, ví dụ: chai nước hoa xoay chậm trên nền đá cẩm thạch",
    preset: "Chuyển động camera",
    upload: "Ảnh khung đầu (không bắt buộc)",
    recent: "Video gần đây",
  },
} as const;

function pick<T>(list: T[] | undefined, value: T | undefined, fallback: T): T {
  if (!list || list.length === 0) return fallback;
  return value !== undefined && list.includes(value) ? value : list[0];
}

export function ErrorNotice({ error }: { error: ApiError }) {
  let body: React.ReactNode = error.message;
  if (error.code === "INSUFFICIENT_CREDIT") {
    body = (
      <>
        Không đủ Credit.{" "}
        <Link href="/credits" className="font-medium underline">
          Nạp thêm Credit
        </Link>
      </>
    );
  } else if (error.code === "MAINTENANCE") {
    body = "Hệ thống đang bảo trì, vui lòng quay lại sau";
  } else if (error.code.startsWith("PLAN_")) {
    body = (
      <>
        Cần gói Pro.{" "}
        <Link href="/pricing" className="font-medium underline">
          Xem bảng giá
        </Link>
      </>
    );
  }
  return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{body}</p>;
}

export function GenerateForm({ kind, fromJobId }: { kind: Kind; fromJobId?: string }) {
  const router = useRouter();
  const text = TEXT[kind];
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [modelId, setModelId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [durationSec, setDurationSec] = useState(5);
  const [presetId, setPresetId] = useState("");
  const [inputUrl, setInputUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const model = useMemo(() => catalog?.models.find((m) => m.id === modelId), [catalog, modelId]);
  const maxDuration = catalog?.plan.maxDurationSec ?? 5;

  // Đổi engine: giữ tham số cũ nếu engine mới hỗ trợ, không thì lấy giá trị đầu tiên hợp lệ.
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
        const usable = cat.models.filter((m) => !m.locked);
        const fromSaved = saved?.kind === kind ? usable.find((m) => m.id === saved.modelId) : undefined;
        const first = fromSaved ?? usable[0];
        if (first) applyModel(first, cat.plan.maxDurationSec, saved?.kind === kind ? saved : {});
        if (saved?.kind === kind) {
          setPrompt(saved.prompt ?? "");
          setPresetId(cat.presets.some((p) => p.id === saved.presetId) ? (saved.presetId ?? "") : "");
          setInputUrl(saved.inputUrl ?? null);
          if (!fromSaved && saved.modelId) setNotice("Engine cũ không còn dùng được, đã chọn engine khác");
        } else if (fromJobId && saved === null) {
          setNotice("Không tải được thiết lập cũ");
        }
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Chỉ nạp một lần theo loại trang / job gốc.
  }, [kind, fromJobId]);

  useEffect(() => {
    if (!modelId || !aspectRatio) return;
    const controller = new AbortController();
    setQuoting(true);
    setCost(null);
    const timer = setTimeout(async () => {
      try {
        // Giá không phụ thuộc prompt; gửi prompt tạm khi ô còn trống để vẫn báo giá được.
        const params =
          kind === "image"
            ? { kind, modelId, prompt: "-", aspectRatio, imageCount }
            : { kind, modelId, prompt: "-", aspectRatio, durationSec };
        const res = await postJson<{ cost: number }>("/api/jobs/quote", params, controller.signal);
        setCost(res.cost);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setCost(null);
      } finally {
        if (!controller.signal.aborted) setQuoting(false);
      }
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [kind, modelId, aspectRatio, imageCount, durationSec]);

  // Ô Prompt đang chứa ý tưởng (tiếng Việt): AI viết lại thành prompt tiếng Anh và thay vào ô.
  async function onAiWrite() {
    const idea = prompt.trim();
    if (!idea) {
      setError(new ApiError("VALIDATION", "Nhập ý tưởng vào ô Prompt trước", 400));
      return;
    }
    setAiWriting(true);
    setError(null);
    setNotice("");
    try {
      const res = await postJson<{ prompt?: string }>("/api/ai/prompt", {
        idea,
        kind,
        ...(aspectRatio ? { aspect: aspectRatio } : {}),
        ...(kind === "video" ? { durationSec } : {}),
      });
      if (res.prompt) setPrompt(res.prompt);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("INTERNAL", (err as Error).message, 0));
    } finally {
      setAiWriting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!model) return;
    setSubmitting(true);
    setError(null);
    setNotice("");
    try {
      await postJson("/api/jobs", {
        kind,
        modelId,
        prompt: prompt.trim(),
        aspectRatio,
        ...(kind === "image" ? { imageCount } : { durationSec }),
        ...(presetId ? { presetId } : {}),
        ...(inputUrl ? { inputUrl } : {}),
      });
      setNotice("Đã gửi tác vụ. Kết quả sẽ hiện ở mục gần đây và trong Thư viện.");
      setRefreshKey((k) => k + 1);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError("INTERNAL", (err as Error).message, 0));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadError) return <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>;
  if (!catalog) return <p className="text-sm text-neutral-500">Đang tải...</p>;
  if (catalog.models.length === 0) {
    return <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Hiện chưa có engine nào hoạt động.</p>;
  }

  const counts = model?.options.counts ?? [1];
  const durations = model?.options.durations ?? [5];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <form onSubmit={onSubmit} className="space-y-5 rounded-xl border border-neutral-200 bg-white p-4 md:p-5">
        <PromptBox value={prompt} onChange={setPrompt} placeholder={text.placeholder} onAiWrite={onAiWrite} aiPending={aiWriting} />
        <EngineSelect models={catalog.models} value={modelId} onChange={(m) => applyModel(m, maxDuration)} unit={text.unit} />
        {model && <AspectRatioPicker ratios={model.options.aspectRatios ?? []} value={aspectRatio} onChange={setAspectRatio} />}

        {kind === "image" && counts.length > 1 && (
          <div className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">Số ảnh</span>
            <div className="flex gap-2">
              {counts.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setImageCount(n)}
                  className={`w-12 rounded-md border py-2 text-sm ${
                    n === imageCount ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}

        {kind === "video" && (
          <div className="space-y-2">
            <span className="text-sm font-medium text-neutral-700">Thời lượng</span>
            <div className="flex gap-2">
              {durations.map((d) => {
                const locked = d > maxDuration;
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={locked}
                    onClick={() => setDurationSec(d)}
                    className={`flex items-center gap-1.5 rounded-md border px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                      d === durationSec ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
                    }`}
                  >
                    {d}s
                    {locked && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{planLabel(1)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <PresetPicker label={text.preset} presets={catalog.presets} value={presetId} onChange={setPresetId} />
        <ImageUpload label={text.upload} value={inputUrl} onChange={setInputUrl} onBusyChange={setUploading} />

        {error && <ErrorNotice error={error} />}
        {notice && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}
        <GenerateButton
          cost={cost}
          quoting={quoting}
          pending={submitting}
          disabled={!model || model.locked || !prompt.trim() || uploading || aiWriting}
        />
      </form>

      <section className="min-w-0 space-y-3">
        <h2 className="text-base font-semibold">{text.recent}</h2>
        <JobGrid fixedKind={kind} refreshKey={refreshKey} />
      </section>
    </div>
  );
}
