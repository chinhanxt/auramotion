"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/Bits";
import { Button, IconButton, Spinner } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Controls";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { Segmented } from "@/components/ui/Segmented";
import { api, planLabel, postJson } from "@/lib/api-client";

type Voice = { id: string; name: string; gender: string; region: string; style: string };
export type VoiceValue = { preset?: string; refUrl?: string };

const MAX_BYTES = 10 * 1024 * 1024;
const REF_MIN_SEC = 3;
const REF_MAX_SEC = 8;
const DEFAULT_VOICE = "Trúc Ly";

// Thời lượng file audio đo bằng trình duyệt; NaN khi không đọc được (để server kiểm).
function audioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (sec: number) => {
      URL.revokeObjectURL(url);
      resolve(sec);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : NaN);
    audio.onerror = () => done(NaN);
    audio.src = url;
  });
}

// Giọng VieNeu có sẵn (lọc giới tính / miền, nghe thử) hoặc "Giọng của tôi" clone từ audio mẫu (gói Pro).
export function VoicePicker({
  value,
  onChange,
  planRank,
  onBusyChange,
}: {
  value: VoiceValue;
  onChange: (v: VoiceValue) => void;
  planRank: number;
  onBusyChange?: (busy: boolean) => void;
}) {
  const cloneLocked = planRank < 1;
  const [tab, setTab] = useState<"preset" | "clone">(value.refUrl && !cloneLocked ? "clone" : "preset");
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [gender, setGender] = useState("");
  const [region, setRegion] = useState("");
  const [previewing, setPreviewing] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lastPreset = useRef(value.preset);
  const lastRef = useRef(value.refUrl);

  useEffect(() => {
    let cancelled = false;
    api<Voice[]>("/api/voices")
      .then((list) => {
        if (cancelled) return;
        setVoices(list);
        if (!value.preset && !value.refUrl && list.length > 0) {
          const preset = (list.find((v) => v.id === DEFAULT_VOICE) ?? list[0]).id;
          lastPreset.current = preset;
          onChange({ preset });
        }
      })
      .catch((err: Error) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
      audioRef.current?.pause();
    };
    // Chỉ nạp danh sách một lần.
  }, []);

  useEffect(() => {
    if (value.preset) lastPreset.current = value.preset;
    if (value.refUrl) lastRef.current = value.refUrl;
  }, [value]);

  function switchTab(next: "preset" | "clone") {
    setTab(next);
    setError("");
    if (next === "preset") onChange(lastPreset.current ? { preset: lastPreset.current } : {});
    else onChange(lastRef.current ? { refUrl: lastRef.current } : {});
  }

  async function preview(key: string, body: VoiceValue) {
    setPreviewing(key);
    onBusyChange?.(true);
    setError("");
    try {
      const { url } = await postJson<{ url: string }>("/api/voices/preview", body);
      audioRef.current?.pause();
      audioRef.current = new Audio(url);
      await audioRef.current.play().catch(() => undefined);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPreviewing("");
      onBusyChange?.(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      if (!file.type.startsWith("audio/")) return setError("Chỉ hỗ trợ âm thanh WAV, MP3, M4A hoặc WebM");
      if (file.size > MAX_BYTES) return setError("File vượt quá 10 MB");
      const sec = await audioDuration(file);
      if (sec < REF_MIN_SEC || sec > REF_MAX_SEC) {
        return setError(`Mẫu giọng nên dài ${REF_MIN_SEC}–${REF_MAX_SEC} giây (file này ${sec.toFixed(1)} giây)`);
      }
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "audio");
      setUploading(true);
      onBusyChange?.(true);
      const { url } = await api<{ url: string }>("/api/uploads", { method: "POST", body: form });
      onChange({ refUrl: url });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      onBusyChange?.(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const genders = [...new Set((voices ?? []).map((v) => v.gender).filter(Boolean))];
  const regions = [...new Set((voices ?? []).map((v) => v.region).filter(Boolean))];
  const shown = (voices ?? []).filter((v) => (!gender || v.gender === gender) && (!region || v.region === region));

  return (
    <div className="space-y-3">
      <Segmented
        block
        size="sm"
        ariaLabel="Nguồn giọng"
        options={[
          { value: "preset" as const, label: "Giọng có sẵn" },
          {
            value: "clone" as const,
            disabled: cloneLocked,
            title: cloneLocked ? `Cần gói ${planLabel(1)}` : undefined,
            label: (
              <>
                Giọng của tôi {cloneLocked && <Icon name="lock" size={12} />}
              </>
            ),
          },
        ]}
        value={tab}
        onChange={switchTab}
      />

      {tab === "preset" && (
        <>
          {loadError && <Notice tone="danger">{loadError}</Notice>}
          {!voices && !loadError && (
            <div className="space-y-1.5">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skel h-12 rounded-m1" />
              ))}
            </div>
          )}
          {voices && (
            <>
              <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1">
                <Chip active={!gender} onClick={() => setGender("")}>
                  Tất cả
                </Chip>
                {genders.map((g) => (
                  <Chip key={g} active={gender === g} onClick={() => setGender(g)}>
                    {g}
                  </Chip>
                ))}
                <span className="mx-0.5 w-px shrink-0 bg-line2" />
                <Chip active={!region} onClick={() => setRegion("")}>
                  Mọi miền
                </Chip>
                {regions.map((r) => (
                  <Chip key={r} active={region === r} onClick={() => setRegion(r)}>
                    {r}
                  </Chip>
                ))}
              </div>
              <ul className="max-h-72 space-y-1 overflow-y-auto pr-0.5" role="listbox" aria-label="Giọng đọc">
                {shown.map((v) => {
                  const active = value.preset === v.id;
                  return (
                    <li
                      key={v.id}
                      className={cx(
                        "flex items-center gap-2 rounded-m1 py-1 pr-1 pl-3 transition-colors",
                        active ? "bg-white/[.08] shadow-[inset_0_0_0_1px_rgba(212,255,58,.55)]" : "hover:bg-white/[.04]",
                      )}
                    >
                      <button type="button" role="option" aria-selected={active} onClick={() => onChange({ preset: v.id })} className="min-w-0 flex-1 py-1.5 text-left">
                        <span className="block truncate text-sm font-medium">{v.name}</span>
                        <span className="block truncate text-xs text-muted">{[v.gender, v.region, v.style].filter(Boolean).join(" · ")}</span>
                      </button>
                      <IconButton
                        icon="play"
                        label="Nghe thử"
                        size="sm"
                        variant={active ? "subtle" : "ghost"}
                        loading={previewing === v.id}
                        disabled={previewing !== "" && previewing !== v.id}
                        onClick={() => preview(v.id, { preset: v.id })}
                      />
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Không có giọng phù hợp</li>}
              </ul>
            </>
          )}
        </>
      )}

      {tab === "clone" && (
        <div className="space-y-2">
          {value.refUrl ? (
            <div className="space-y-2 rounded-m2 bg-white/[.03] p-3 hairline">
              <audio src={value.refUrl} controls className="h-9 w-full" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="subtle" icon="play" loading={previewing === "ref"} disabled={previewing !== "" && previewing !== "ref"} onClick={() => preview("ref", { refUrl: value.refUrl })}>
                  Nghe giọng clone
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="refresh"
                  onClick={() => {
                    lastRef.current = undefined;
                    onChange({});
                  }}
                >
                  Đổi mẫu
                </Button>
              </div>
            </div>
          ) : (
            <label className="press flex cursor-pointer flex-col items-center justify-center gap-2 rounded-m2 border border-dashed border-white/15 bg-white/[.02] px-4 py-6 text-center text-sm text-muted hover:border-white/30 hover:text-fg">
              {uploading ? <Spinner /> : <Icon name="mic" size={22} />}
              <span className="font-medium text-fg/85">{uploading ? "Đang tải lên…" : "Tải mẫu giọng"}</span>
              <span className="text-xs">
                {REF_MIN_SEC}–{REF_MAX_SEC} giây · WAV, MP3, M4A, WebM
              </span>
              <input ref={fileRef} type="file" accept="audio/*" className="hidden" disabled={uploading} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
