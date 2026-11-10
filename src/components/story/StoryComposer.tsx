"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { AutoTextarea, RatioShape, ToolButton } from "@/components/studio/Composer";
import { useErrorToast } from "@/components/studio/errors";
import { PresetCover, PresetGallery } from "@/components/studio/PresetGallery";
import { Notice } from "@/components/ui/Bits";
import { Spinner } from "@/components/ui/Button";
import { Stepper, Switch } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { MenuItem, Popover } from "@/components/ui/Overlay";
import { Segmented } from "@/components/ui/Segmented";
import { useToast } from "@/components/ui/Toast";
import { formatCredit, isNotFound, postJson, type StoryItem } from "@/lib/api-client";
import { useShotQuote, useStoryCatalog } from "./useStoryCatalog";

const IDEAS = ["Một ngày của chú mèo cam ở phố cổ Hội An", "Ra mắt chai nước hoa hổ phách, cảm giác buổi tối", "Hành trình ly cà phê từ hạt đến tay người uống"];

export function StoryComposer({ initialIdea = "" }: { initialIdea?: string }) {
  const router = useRouter();
  const toast = useToast();
  const showError = useErrorToast();
  const cat = useStoryCatalog();
  const [idea, setIdea] = useState(initialIdea);
  const [skillId, setSkillId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [cameraId, setCameraId] = useState("");
  const [aspect, setAspect] = useState("9:16");
  const [shotCount, setShotCount] = useState(4);
  const [shotDurationSec, setShotDuration] = useState<5 | 10>(5);
  const [mode, setMode] = useState<"PARALLEL" | "CHAIN">("PARALLEL");
  const [autoAssemble, setAutoAssemble] = useState(true);
  const [autoRun, setAutoRun] = useState(false);
  const [gallery, setGallery] = useState<"style" | "camera" | null>(null);
  const [busy, setBusy] = useState(false);

  const total = useShotQuote(cat?.videoModel ?? null, aspect, shotDurationSec, shotCount);
  const maxDur = cat?.plan?.maxDurationSec ?? 5;
  const style = cat?.styles.find((p) => p.id === styleId);
  const camera = cat?.cameras.find((p) => p.id === cameraId);
  const skill = cat?.skills.find((s) => s.id === skillId);
  const blocked = cat?.videoUnavailable === true;
  const ratios = cat?.ratios ?? ["9:16", "16:9", "1:1"];

  async function submit() {
    if (!idea.trim() || busy) return;
    setBusy(true);
    try {
      const { story } = await postJson<{ story: StoryItem }>("/api/stories", {
        idea: idea.trim(),
        ...(skillId ? { skillId } : {}),
        ...(styleId ? { styleId } : {}),
        ...(cameraId ? { cameraId } : {}),
        aspect,
        shotCount,
        shotDurationSec,
        mode,
        autoRun: autoRun && !blocked,
        autoAssemble,
      });
      router.push(`/studio/story/${story.id}`);
    } catch (e) {
      if (isNotFound(e)) toast.error("Máy chủ chưa bật Story");
      else showError(e);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="relative mx-auto w-full max-w-[1040px] rounded-m4 bg-s1 px-3 pt-3 pb-3 shadow-[0_0_0_1px_var(--color-line2),0_30px_80px_-30px_rgba(124,92,255,.35)] transition-shadow duration-200 focus-within:shadow-[0_0_0_1px_rgba(212,255,58,.32),0_30px_80px_-30px_rgba(124,92,255,.35)] sm:px-4 sm:pt-3 sm:pb-4"
    >
      <AutoTextarea value={idea} onChange={setIdea} onSubmit={submit} placeholder="Kể ý tưởng câu chuyện của bạn…" className="min-h-24 px-0.5 pt-1 pb-1 text-[17px] sm:pt-1.5" ariaLabel="Ý tưởng" />
      {!idea && (
        <div className="no-scrollbar mt-1 flex gap-1.5 overflow-x-auto">
          {IDEAS.map((s) => (
            <button key={s} type="button" onClick={() => setIdea(s)} className="press shrink-0 rounded-full bg-white/[.04] px-3 py-1.5 text-xs text-muted hover:bg-white/[.08] hover:text-fg">
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
        {cat && cat.skills.length > 0 && (
          <Popover
            side="bottom"
            className="w-72"
            trigger={({ toggle, ref, ...aria }) => (
              <ToolButton ref={ref} onClick={toggle} {...aria} active={Boolean(skill)} tip="Skill kịch bản">
                <Icon name="wand" size={16} className="text-accent" />
                <span className="max-w-32 truncate">{skill?.name ?? "Skill"}</span>
                <Icon name="chevronDown" size={14} className="text-muted" />
              </ToolButton>
            )}
          >
            {(close) => (
              <>
                <MenuItem active={!skillId} onClick={() => (setSkillId(""), close())}>
                  Mặc định
                </MenuItem>
                {cat.skills.map((s) => (
                  <MenuItem key={s.id} active={s.id === skillId} disabled={s.locked} hint={s.locked ? "Pro" : undefined} onClick={() => (setSkillId(s.id), close())}>
                    <span className="block truncate">{s.name}</span>
                    {s.description && <span className="block truncate text-xs text-muted">{s.description}</span>}
                  </MenuItem>
                ))}
              </>
            )}
          </Popover>
        )}
        {cat && cat.styles.length > 0 && (
          <ToolButton onClick={() => setGallery("style")} active={Boolean(style)} tip="Phong cách" className="pl-1.5">
            {style ? <PresetCover preset={style} className="h-6 w-6 rounded-[7px]" /> : <Icon name="palette" size={16} className="mx-1" />}
            <span className="max-w-28 truncate">{style?.name ?? "Phong cách"}</span>
          </ToolButton>
        )}
        {cat && cat.cameras.length > 0 && (
          <ToolButton onClick={() => setGallery("camera")} active={Boolean(camera)} tip="Camera" className="pl-1.5">
            {camera ? <PresetCover preset={camera} className="h-6 w-6 rounded-[7px]" /> : <Icon name="camera" size={16} className="mx-1" />}
            <span className="max-w-28 truncate">{camera?.name ?? "Camera"}</span>
          </ToolButton>
        )}
        <Segmented
          size="sm"
          ariaLabel="Tỷ lệ khung"
          options={ratios.map((r) => ({ value: r, label: <><RatioShape ratio={r} size={12} />{r}</> }))}
          value={aspect}
          onChange={setAspect}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 px-0.5">
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
          <span className="text-sm whitespace-nowrap text-fg/80">Số cảnh</span>
          <Stepper value={shotCount} onChange={setShotCount} min={2} max={8} ariaLabel="Số cảnh" />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
          <span className="text-sm whitespace-nowrap text-fg/80">Mỗi cảnh</span>
          <Segmented
            size="sm"
            ariaLabel="Thời lượng mỗi cảnh"
            options={([5, 10] as const).map((d) => ({ value: d, disabled: d > maxDur, title: d > maxDur ? "Cần gói Pro" : undefined, label: <>{d}s{d > maxDur && <Icon name="lock" size={11} />}</> }))}
            value={shotDurationSec}
            onChange={setShotDuration}
          />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
          <span className="text-sm whitespace-nowrap text-fg/80">Cách quay</span>
          <Segmented
            size="sm"
            ariaLabel="Cách quay"
            options={[
              { value: "PARALLEL" as const, label: "Song song", title: "Các cảnh quay cùng lúc" },
              { value: "CHAIN" as const, label: "Nối cảnh", title: "Cảnh sau nối từ khung cuối cảnh trước" },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
        <div className="w-full sm:w-52">
          <Switch checked={autoAssemble} onChange={setAutoAssemble} label="Tự ghép khi xong" />
        </div>
      </div>

      {blocked && (
        <Notice tone="warn" className="mt-3">
          Video Muse tạm không khả dụng — vẫn lập được kịch bản.
        </Notice>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="sm:w-64">
          <Switch checked={autoRun && !blocked} onChange={setAutoRun} disabled={blocked} label="Quay luôn sau khi lập" hint={total !== null ? `≈ ${formatCredit(total)} Credit` : undefined} />
        </div>
        <button
          type="submit"
          disabled={!idea.trim() || busy}
          className={cx(
            "press inline-flex h-12 items-center justify-center gap-2 rounded-m2 bg-accent px-6 text-[15px] font-bold text-accent-ink shadow-[0_10px_30px_-10px_rgba(212,255,58,.6)] hover:bg-[#e0ff6b] disabled:bg-white/[.08] disabled:text-muted disabled:shadow-none sm:ml-auto",
          )}
        >
          {busy ? <Spinner /> : <Icon name="sparkle" size={18} />}
          Lập kịch bản
        </button>
      </div>

      {cat && (
        <>
          <PresetGallery open={gallery === "style"} onClose={() => setGallery(null)} presets={cat.styles} value={styleId} onChange={setStyleId} title="Phong cách" />
          <PresetGallery open={gallery === "camera"} onClose={() => setGallery(null)} presets={cat.cameras} value={cameraId} onChange={setCameraId} title="Chuyển động camera" />
        </>
      )}
    </form>
  );
}
