"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { buttonClass, inputClass } from "./format";

export type FieldType = "text" | "number" | "textarea" | "select" | "checkbox" | "json";

export type Field = {
  name: string;
  label: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  placeholder?: string;
  step?: string;
  hint?: string;
  wide?: boolean;
};

type Value = string | boolean;

function toFormValue(field: Field, value: unknown): Value {
  if (field.type === "checkbox") return Boolean(value);
  if (field.type === "json") return JSON.stringify(value ?? null, null, 2);
  return value === null || value === undefined ? "" : String(value);
}

// Form thêm / sửa một bản ghi: gửi JSON tới `url`, xong thì làm mới trang.
// `extra` gộp thêm vào body (ví dụ id), `nest` bọc giá trị trong một khóa (ví dụ prompt_writer).
export function EntityForm({
  fields,
  initial = {},
  url,
  method,
  extra,
  nest,
  submitLabel = "Lưu",
  resetOnSuccess = false,
  inline = false,
}: {
  fields: Field[];
  initial?: Record<string, unknown>;
  url: string;
  method: "POST" | "PATCH";
  extra?: Record<string, unknown>;
  nest?: string;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  inline?: boolean;
}) {
  const router = useRouter();
  const initialValues = () => Object.fromEntries(fields.map((f) => [f.name, toFormValue(f, initial[f.name])]));
  const [values, setValues] = useState<Record<string, Value>>(initialValues);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  function set(name: string, value: Value) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const data: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.name];
      if (f.type === "checkbox") data[f.name] = v;
      else if (f.type === "number") data[f.name] = v === "" ? undefined : Number(v);
      else if (f.type === "json") {
        try {
          data[f.name] = JSON.parse(String(v));
        } catch {
          setMessage({ kind: "error", text: `${f.label}: JSON không hợp lệ` });
          return;
        }
      } else data[f.name] = v;
    }
    const body = { ...extra, ...(nest ? { [nest]: data } : data) };
    setPending(true);
    try {
      await api(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      setMessage({ kind: "success", text: "Đã lưu" });
      if (resetOnSuccess) setValues(initialValues());
      router.refresh();
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className={inline ? "flex flex-wrap items-end gap-2" : "space-y-3"}>
      <div className={inline ? "contents" : "grid gap-3 sm:grid-cols-2"}>
        {fields.map((f) => {
          const id = `${url}-${f.name}-${String(extra?.id ?? "new")}`;
          if (f.type === "checkbox") {
            return (
              <label key={f.name} htmlFor={id} className="flex items-center gap-2 self-end py-2 text-sm text-neutral-800">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(values[f.name])}
                  onChange={(e) => set(f.name, e.target.checked)}
                  className="h-4 w-4"
                />
                {f.label}
              </label>
            );
          }
          const common = {
            id,
            value: String(values[f.name]),
            placeholder: f.placeholder,
            className: inputClass,
          };
          return (
            <label
              key={f.name}
              htmlFor={id}
              className={`block space-y-1 text-sm ${f.wide || f.type === "json" || f.type === "textarea" ? "sm:col-span-2" : ""} ${inline ? "min-w-28" : ""}`}
            >
              <span className="font-medium text-neutral-700">{f.label}</span>
              {f.type === "select" ? (
                <select {...common} onChange={(e) => set(f.name, e.target.value)}>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" || f.type === "json" ? (
                <textarea
                  {...common}
                  rows={f.type === "json" ? 4 : 2}
                  className={`${inputClass} ${f.type === "json" ? "font-mono text-xs" : ""}`}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : (
                <input
                  {...common}
                  type={f.type}
                  step={f.type === "number" ? (f.step ?? "any") : undefined}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
              {f.hint && <span className="block text-xs text-neutral-500">{f.hint}</span>}
            </label>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? "Đang lưu…" : submitLabel}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === "error" ? "text-red-700" : "text-green-700"}`}>{message.text}</span>
        )}
      </div>
    </form>
  );
}
