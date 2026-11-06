"use client";

const MAX_LENGTH = 2000;

// onAiWrite: nút "AI viết prompt", chỉ hiện khi được truyền vào.
export function PromptBox({
  value,
  onChange,
  placeholder,
  onAiWrite,
  aiPending = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onAiWrite?: () => void;
  aiPending?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="prompt" className="text-sm font-medium text-neutral-700">
          Prompt
        </label>
        {onAiWrite && (
          <button
            type="button"
            onClick={onAiWrite}
            disabled={aiPending}
            className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50"
          >
            {aiPending ? "AI đang viết..." : "AI viết prompt"}
          </button>
        )}
      </div>
      <textarea
        id="prompt"
        value={value}
        maxLength={MAX_LENGTH}
        rows={5}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-1 focus:ring-neutral-900"
      />
      <p className="text-right text-xs text-neutral-400">
        {value.length}/{MAX_LENGTH}
      </p>
    </div>
  );
}
