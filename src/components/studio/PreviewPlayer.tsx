"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { liteUrl, thumbUrl } from "@/lib/media-url";
import { ratioCss } from "@/lib/api-client";
import { clipSeconds, type TimelineClip } from "./ClipTimeline";

export type VoicePreview = { url: string; segments: { text: string; start: number; end: number }[] };
// Cùng số với tools/post/assemble.py để xem thử khớp bản xuất.
const VOICE_DELAY = 0.3;
const TAIL = 0.6;
const WORDS_PER_CAPTION = 7;

// Câu dài chia nhiều dòng phụ đề (≤ 7 chữ), thời gian chia theo số ký tự — giống assemble.py.
function captionsOf(segments: VoicePreview["segments"]): { a: number; b: number; text: string }[] {
  const rows: { a: number; b: number; text: string }[] = [];
  for (const s of segments) {
    const words = s.text.split(/\s+/).filter(Boolean);
    const chunks = Array.from({ length: Math.ceil(words.length / WORDS_PER_CAPTION) || 1 }, (_, i) => words.slice(i * WORDS_PER_CAPTION, (i + 1) * WORDS_PER_CAPTION).join(" "));
    const sum = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let t = s.start;
    for (const c of chunks) {
      const d = ((s.end - s.start) * c.length) / sum;
      rows.push({ a: t + VOICE_DELAY, b: t + d + VOICE_DELAY, text: c });
      t += d;
    }
  }
  return rows;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Xem thử cả video ghép ngay trên trình duyệt (không cần Xuất): phát lần lượt các clip theo điểm cắt,
// phụ đề chia đều theo thời lượng, nhạc nền chạy cùng. Giọng đọc chỉ có sau khi xuất.
export function PreviewPlayer({
  clips,
  aspect,
  lines,
  subtitles,
  musicUrl,
  keepClipAudio,
  voice,
  selectedKey,
  onSelect,
}: {
  clips: TimelineClip[];
  aspect: string;
  lines: string[];
  subtitles: boolean;
  musicUrl?: string;
  keepClipAudio: boolean;
  voice?: VoicePreview | null;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const durs = useMemo(() => clips.map(clipSeconds), [clips]);
  const offsets = useMemo(() => durs.reduce<number[]>((a, d, i) => (a.push(i === 0 ? 0 : a[i - 1] + durs[i - 1]), a), []), [durs]);
  const clipsTotal = durs.reduce((s, d) => s + d, 0);
  // Giọng dài hơn video: giữ khung hình cuối cho tới hết giọng (như bản xuất).
  const voiceEnd = voice && voice.segments.length > 0 ? voice.segments[voice.segments.length - 1].end + VOICE_DELAY + TAIL : 0;
  const extra = Math.max(0, voiceEnd - clipsTotal);
  const total = clipsTotal + extra;
  const captions = useMemo(() => (voice ? captionsOf(voice.segments) : []), [voice]);
  const voiceRef = useRef<HTMLAudioElement>(null);

  const [ci, setCi] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [local, setLocal] = useState(0);
  const [muted, setMuted] = useState(false);
  const localRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const clip = clips[Math.min(ci, clips.length - 1)] ?? null;
  const next = clips[ci + 1];

  // Danh sách thay đổi (thêm/xóa/cắt): giữ vị trí hợp lệ.
  useEffect(() => {
    if (ci >= clips.length) {
      setCi(Math.max(0, clips.length - 1));
      localRef.current = 0;
      setLocal(0);
    }
  }, [clips.length, ci]);

  const go = useCallback(
    (index: number, at = 0) => {
      localRef.current = at;
      setLocal(at);
      setCi(index);
    },
    [],
  );

  // Vào clip mới / tua: đặt lại điểm phát của video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !clip || clip.kind !== "video") return;
    const apply = () => {
      v.currentTime = clip.in + localRef.current;
      if (playing) v.play().catch(() => {});
    };
    if (v.readyState >= 1) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
    return () => v.removeEventListener("loadedmetadata", apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.key, clip?.in]);

  // Nhịp phát.
  useEffect(() => {
    const v = videoRef.current;
    if (!playing || !clip) {
      v?.pause();
      audioRef.current?.pause();
      voiceRef.current?.pause();
      return;
    }
    if (clip.kind === "video") v?.play().catch(() => {});
    audioRef.current?.play().catch(() => {});
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const vid = videoRef.current;
      const isLast = ci === clips.length - 1;
      const base = durs[ci] ?? 0;
      if (clip.kind === "video" && vid && isLast && localRef.current >= base) {
        vid.pause(); // hết clip cuối nhưng giọng còn: giữ khung hình
        localRef.current += dt;
      } else if (clip.kind === "video" && vid && vid.readyState >= 2) localRef.current = Math.max(0, vid.currentTime - clip.in);
      else if (clip.kind === "image") localRef.current += dt;
      const dur = base + (isLast ? extra : 0);
      // Giọng đọc bám theo đồng hồ chung (vào sau VOICE_DELAY, sửa lệch khi tua).
      const va = voiceRef.current;
      if (va) {
        const want = (offsets[ci] ?? 0) + localRef.current - VOICE_DELAY;
        if (want < 0) {
          if (!va.paused) va.pause();
        } else if (va.paused || Math.abs(va.currentTime - want) > 0.3) {
          va.currentTime = want;
          va.play().catch(() => {});
        }
      }
      if (localRef.current >= dur - 0.03) {
        if (ci + 1 < clips.length) {
          onSelect(clips[ci + 1].key);
          go(ci + 1, 0);
        } else {
          setPlaying(false);
          onSelect(clips[0].key);
          go(0, 0);
        }
        return;
      }
      setLocal(localRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, ci, clip?.key, extra]);

  const globalT = (offsets[ci] ?? 0) + local;

  const seek = useCallback(
    (t: number) => {
      const target = Math.min(Math.max(0, t), Math.max(0, total - 0.05));
      let i = offsets.findIndex((o, k) => target >= o && target < o + durs[k] + (k === clips.length - 1 ? extra : 0));
      if (i < 0) i = Math.max(0, clips.length - 1);
      const at = target - (offsets[i] ?? 0);
      const v = videoRef.current;
      if (i === ci && clip?.kind === "video" && v) v.currentTime = clip.in + at;
      go(i, at);
      if (clips[i]) onSelect(clips[i].key);
      const a = audioRef.current;
      if (a && a.duration) a.currentTime = target % a.duration;
    },
    [clip?.kind, clip?.in, ci, clips, durs, extra, go, offsets, onSelect, total],
  );

  // Bấm clip trên timeline → nhảy tới đầu clip đó.
  const prevLen = useRef(clips.length);
  useEffect(() => {
    const added = clips.length > prevLen.current; // thêm clip mới: không nhảy vị trí phát
    prevLen.current = clips.length;
    if (!selectedKey || added) return;
    const i = clips.findIndex((c) => c.key === selectedKey);
    if (i >= 0 && i !== ci) go(i, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = voice ? 0.2 : 0.45;
  }, [musicUrl, voice]);

  const line = !subtitles
    ? null
    : voice
      ? (captions.find((c) => globalT >= c.a && globalT < c.b)?.text ?? null)
      : lines.length > 0 && total > 0
        ? lines[Math.min(lines.length - 1, Math.floor((globalT / total) * lines.length))]
        : null;

  function toggle() {
    if (clips.length === 0) return;
    setPlaying((p) => !p);
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div
        className="group/pv relative overflow-hidden rounded-m2 bg-s2 shadow-2xl"
        style={{ aspectRatio: ratioCss(aspect), height: "clamp(220px, 40dvh, 560px)", maxWidth: "100%" }}
      >
        {clip ? (
          <button type="button" onClick={toggle} aria-label={playing ? "Tạm dừng" : "Phát"} className="absolute inset-0 block h-full w-full cursor-pointer">
            {clip.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={clip.key} src={thumbUrl(clip.url, 960)} alt="" className="blur-in h-full w-full object-cover" />
            ) : (
              <video
                key={clip.key}
                ref={videoRef}
                src={liteUrl(clip.url)}
                muted={!keepClipAudio || muted}
                playsInline
                preload="auto"
                className="blur-in h-full w-full object-cover"
              />
            )}
            <span
              className={cx(
                "absolute inset-0 flex items-center justify-center bg-black/25 transition-opacity duration-200",
                playing ? "opacity-0 group-hover/pv:opacity-100" : "opacity-100",
              )}
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)]">
                <Icon name={playing ? "pause" : "play"} size={26} />
              </span>
            </span>
          </button>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <Icon name="film" size={26} />
            <span className="text-sm">Thêm clip để xem trước</span>
          </div>
        )}
        {line && (
          <span key={line} className="blur-in pointer-events-none absolute inset-x-3 bottom-[12%] text-center text-[13px] leading-snug font-bold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9)]">
            {line}
          </span>
        )}
        {next?.kind === "video" && <video src={liteUrl(next.url)} preload="auto" muted className="hidden" aria-hidden="true" />}
        {voice && <audio ref={voiceRef} src={voice.url} preload="auto" muted={muted} />}
        {musicUrl && <audio ref={audioRef} src={musicUrl} loop preload="auto" muted={muted} />}
      </div>

      {clips.length > 0 && (
        <div className="flex w-full max-w-[640px] items-center gap-3 px-1">
          <button type="button" onClick={toggle} aria-label={playing ? "Tạm dừng" : "Phát"} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[.1] hover:bg-white/[.18]">
            <Icon name={playing ? "pause" : "play"} size={16} />
          </button>
          <span className="w-10 shrink-0 text-right text-[12px] text-muted tabular-nums">{fmt(globalT)}</span>
          <div className="relative flex h-6 min-w-0 flex-1 items-center">
            <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-[2px] overflow-hidden rounded-full">
              {durs.map((d0, i) => {
                const d = d0 + (i === durs.length - 1 ? extra : 0);
                return (
                <span key={clips[i].key} className="relative h-full overflow-hidden bg-white/[.12]" style={{ flexGrow: d, flexBasis: 0 }}>
                  <span
                    className="absolute inset-y-0 left-0 bg-accent"
                    style={{ width: `${globalT >= offsets[i] + d ? 100 : globalT <= offsets[i] ? 0 : ((globalT - offsets[i]) / d) * 100}%` }}
                  />
                </span>
              );
              })}
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(total, 0.1)}
              step={0.05}
              value={globalT}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Tua"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </div>
          <span className="w-10 shrink-0 text-[12px] text-muted tabular-nums">{fmt(total)}</span>
          {(musicUrl || keepClipAudio || voice) && (
            <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Bật tiếng" : "Tắt tiếng"} className="press flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/[.08] hover:text-fg">
              <Icon name="volume" size={16} className={cx(muted && "opacity-40")} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
