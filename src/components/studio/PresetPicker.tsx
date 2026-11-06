"use client";

import type { CatalogPreset } from "@/lib/api-client";

export function PresetPicker({
  label,
  presets,
  value,
  onChange,
}: {
  label: string;
  presets: CatalogPreset[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (presets.length === 0) return null;
  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${
      active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
    }`;
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => onChange("")} className={chip(value === "")}>
          Không dùng
        </button>
        {presets.map((p) => (
          <button key={p.id} type="button" title={p.promptSuffix} onClick={() => onChange(p.id)} className={chip(value === p.id)}>
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}
