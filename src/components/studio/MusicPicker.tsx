"use client";

import { useEffect, useRef, useState } from "react";

type Track = { id: string; name: string; file: string };

// Không nhạc hoặc một bài trong music_tracks; nút nghe thử phát / dừng bài.
export function MusicPicker({ tracks, value, onChange }: { tracks: Track[]; value: string; onChange: (id: string) => void }) {
  const [playing, setPlaying] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => audioRef.current?.pause(), []);

  function toggle(track: Track) {
    audioRef.current?.pause();
    if (playing === track.id) return setPlaying("");
    const audio = new Audio(track.file);
    audio.onended = () => setPlaying("");
    audioRef.current = audio;
    setPlaying(track.id);
    audio.play().catch(() => setPlaying(""));
  }

  const option = (active: boolean) =>
    `flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
    }`;

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">Nhạc nền</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => onChange("")} className={option(value === "")}>
          Không nhạc
        </button>
        {tracks.map((t) => (
          <div key={t.id} className={option(value === t.id)}>
            <button type="button" onClick={() => onChange(t.id)} className="min-w-0 flex-1 truncate text-left">
              {t.name}
            </button>
            <button
              type="button"
              onClick={() => toggle(t)}
              aria-label={playing === t.id ? "Dừng" : "Nghe thử"}
              className="shrink-0 rounded px-1.5 text-xs opacity-80 hover:opacity-100"
            >
              {playing === t.id ? "■ Dừng" : "▶ Nghe"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
