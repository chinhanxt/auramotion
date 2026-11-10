"use client";

import { useEffect, useRef, useState } from "react";
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
      }`}
    >
      {children}
    </button>
  );
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
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-neutral-700">Giọng đọc</span>
        <div className="flex rounded-md border border-neutral-300 bg-white p-0.5">
          <button
            type="button"
            onClick={() => switchTab("preset")}
            className={`rounded px-3 py-1 text-sm ${tab === "preset" ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
          >
            Giọng có sẵn
          </button>
          <button
            type="button"
            disabled={cloneLocked}
            onClick={() => switchTab("clone")}
            className={`flex items-center gap-1.5 rounded px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
              tab === "clone" ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"
            }`}
          >
            Giọng của tôi
            {cloneLocked && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">{planLabel(1)}</span>}
          </button>
        </div>
      </div>

      {tab === "preset" && (
        <>
          {loadError && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>}
          {!voices && !loadError && <p className="text-sm text-neutral-500">Đang tải danh sách giọng...</p>}
          {voices && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={!gender} onClick={() => setGender("")}>
                  Tất cả
                </Chip>
                {genders.map((g) => (
                  <Chip key={g} active={gender === g} onClick={() => setGender(g)}>
                    {g}
                  </Chip>
                ))}
                <span className="mx-1 w-px bg-neutral-200" />
                <Chip active={!region} onClick={() => setRegion("")}>
                  Mọi miền
                </Chip>
                {regions.map((r) => (
                  <Chip key={r} active={region === r} onClick={() => setRegion(r)}>
                    {r}
                  </Chip>
                ))}
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-neutral-200 p-1">
                {shown.map((v) => {
                  const active = value.preset === v.id;
                  return (
                    <li key={v.id} className={`flex items-center gap-2 rounded px-2 py-1.5 ${active ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"}`}>
                      <button type="button" onClick={() => onChange({ preset: v.id })} className="min-w-0 flex-1 text-left text-sm">
                        <span className="font-medium">{v.name}</span>
                        <span className={`ml-2 text-xs ${active ? "text-neutral-300" : "text-neutral-500"}`}>
                          {[v.gender, v.region, v.style].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={previewing !== ""}
                        onClick={() => preview(v.id, { preset: v.id })}
                        className={`shrink-0 rounded border px-2 py-0.5 text-xs disabled:opacity-50 ${
                          active ? "border-neutral-500 hover:bg-neutral-800" : "border-neutral-300 hover:bg-white"
                        }`}
                      >
                        {previewing === v.id ? "Đang đọc..." : "Nghe thử"}
                      </button>
                    </li>
                  );
                })}
                {shown.length === 0 && <li className="px-2 py-1.5 text-sm text-neutral-500">Không có giọng phù hợp</li>}
              </ul>
            </>
          )}
        </>
      )}

      {tab === "clone" && (
        <div className="space-y-2">
          {value.refUrl ? (
            <div className="flex flex-wrap items-center gap-2">
              <audio src={value.refUrl} controls className="h-9 max-w-full" />
              <button
                type="button"
                disabled={previewing !== ""}
                onClick={() => preview("ref", { refUrl: value.refUrl })}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-50"
              >
                {previewing === "ref" ? "Đang đọc..." : "Nghe thử giọng clone"}
              </button>
              <button
                type="button"
                onClick={() => {
                  lastRef.current = undefined;
                  onChange({});
                }}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
              >
                Đổi mẫu
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer items-center justify-center rounded-md border border-dashed border-neutral-300 bg-white px-3 py-4 text-sm text-neutral-600 hover:border-neutral-500">
              {uploading ? "Đang tải lên..." : `Tải audio mẫu giọng ${REF_MIN_SEC}–${REF_MAX_SEC} giây (WAV, MP3, M4A, WebM)`}
              <input ref={fileRef} type="file" accept="audio/*" className="hidden" disabled={uploading} onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
