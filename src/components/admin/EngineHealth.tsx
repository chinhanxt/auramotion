"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { secondaryButtonClass } from "./format";

type Health = {
  muse: { ok: boolean; driver: string | null; accounts: number | null };
  agy: { ok: boolean; version?: string };
  codex: { ok: boolean; version?: string };
  vieneu: { ok: boolean };
  ffmpeg: { ok: boolean };
};

export function EngineHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const check = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setHealth(await api<Health>("/api/admin/engines/health"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const rows: [string, boolean, string][] = health
    ? [
        [
          "MUSE (muse2api)",
          health.muse.ok,
          health.muse.ok ? `driver ${health.muse.driver ?? "?"} · ${health.muse.accounts ?? 0} tài khoản khả dụng` : "Không kết nối được",
        ],
        ["Gemini (agy)", health.agy.ok, health.agy.version ?? ""],
        ["Codex", health.codex.ok, health.codex.version ?? ""],
        ["Giọng VieNeu", health.vieneu.ok, ""],
        ["ffmpeg", health.ffmpeg.ok, ""],
      ]
    : [];

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-neutral-100 text-sm">
        {rows.map(([name, ok, detail]) => (
          <li key={name} className="flex items-center justify-between gap-3 py-2">
            <span className="font-medium text-neutral-800">{name}</span>
            <span className="flex items-center gap-2 text-right text-neutral-600">
              {detail && <span className="text-xs">{detail}</span>}
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                {ok ? "Hoạt động" : "Lỗi"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button type="button" onClick={check} disabled={loading} className={secondaryButtonClass}>
        {loading ? "Đang kiểm tra…" : "Kiểm tra kết nối"}
      </button>
    </div>
  );
}
