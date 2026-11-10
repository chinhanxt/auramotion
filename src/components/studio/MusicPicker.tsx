"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";

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

  const row = (active: boolean) =>
    cx(
      "flex items-center gap-2 rounded-m1 py-1 pr-1 pl-3 transition-colors",
      active ? "bg-white/[.08] shadow-[inset_0_0_0_1px_rgba(212,255,58,.55)]" : "hover:bg-white/[.04]",
    );

  return (
    <ul className="space-y-1" role="listbox" aria-label="Nhạc nền">
      <li className={row(value === "")}>
        <button type="button" role="option" aria-selected={value === ""} onClick={() => onChange("")} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left text-sm">
          <Icon name="close" size={16} className="text-muted" />
          Không nhạc
        </button>
      </li>
      {tracks.map((t) => (
        <li key={t.id} className={row(value === t.id)}>
          <button type="button" role="option" aria-selected={value === t.id} onClick={() => onChange(t.id)} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 text-left text-sm">
            <Icon name="music" size={16} className="text-muted" />
            <span className="truncate">{t.name}</span>
            {playing === t.id && (
              <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
                <span className="eq-bar" />
                <span className="eq-bar [animation-delay:-.3s]" />
                <span className="eq-bar [animation-delay:-.6s]" />
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => toggle(t)}
            aria-label={playing === t.id ? "Dừng" : "Nghe thử"}
            className={cx("press flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] hover:bg-white/[.08]", playing === t.id ? "text-accent" : "text-muted")}
          >
            <Icon name={playing === t.id ? "stop" : "play"} size={15} />
          </button>
        </li>
      ))}
    </ul>
  );
}
