"use client";

const LABEL: Record<string, string> = {
  "1:1": "Vuông",
  "9:16": "Dọc",
  "16:9": "Ngang",
  "4:5": "Dọc 4:5",
};

function Shape({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(":").map(Number);
  const scale = 18 / Math.max(w, h);
  return <span className="inline-block rounded-sm border border-current" style={{ width: w * scale, height: h * scale }} />;
}

export function AspectRatioPicker({ ratios, value, onChange }: { ratios: string[]; value: string; onChange: (r: string) => void }) {
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-neutral-700">Tỷ lệ khung</span>
      <div className="flex flex-wrap gap-2">
        {ratios.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(r)}
            className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
              r === value ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white hover:border-neutral-500"
            }`}
          >
            <Shape ratio={r} />
            {r}
            {LABEL[r] && <span className="hidden text-xs opacity-70 sm:inline">{LABEL[r]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
