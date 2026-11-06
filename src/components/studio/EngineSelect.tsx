"use client";

import { formatCredit, planLabel, type CatalogModel } from "@/lib/api-client";

const SLOW_PROVIDERS = ["AGY", "CODEX"];

export function EngineSelect({
  models,
  value,
  onChange,
  unit,
}: {
  models: CatalogModel[];
  value: string;
  onChange: (model: CatalogModel) => void;
  unit: string;
}) {
  const selected = models.find((m) => m.id === value);
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">Engine</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {models.map((m) => {
          const active = m.id === value;
          return (
            <button
              key={m.id}
              type="button"
              disabled={m.locked}
              onClick={() => onChange(m)}
              className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
              }`}
            >
              <span>
                <span className="block font-medium">{m.name}</span>
                <span className={`block text-xs ${active ? "text-neutral-300" : "text-neutral-500"}`}>
                  {formatCredit(m.baseCost)} Credit/{unit}
                </span>
              </span>
              {m.locked && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                  {planLabel(m.minPlanRank)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {selected && SLOW_PROVIDERS.includes(selected.provider) && (
        <p className="text-xs text-neutral-500">Engine này tạo mỗi ảnh mất 1–4 phút.</p>
      )}
    </div>
  );
}
