"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/Button";
import { Empty } from "@/components/ui/Bits";
import { cx } from "@/components/ui/cx";
import { Icon } from "@/components/ui/Icon";
import { MenuItem, Modal, Popover } from "@/components/ui/Overlay";
import { useToast } from "@/components/ui/Toast";
import { api, type JobItem } from "@/lib/api-client";

const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function uploadImage(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error("Chỉ hỗ trợ ảnh JPEG, PNG hoặc WebP");
  if (file.size > MAX_BYTES) throw new Error("Ảnh vượt quá 10 MB");
  const form = new FormData();
  form.append("file", file);
  form.append("kind", "image");
  const { url } = await api<{ url: string }>("/api/uploads", { method: "POST", body: form });
  return url;
}

// Chọn lại ảnh đã tạo (dùng lại làm tham chiếu / khung đầu).
export function LibraryImagePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const [items, setItems] = useState<JobItem[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || items) return;
    api<{ items: JobItem[] }>("/api/jobs?kind=image&status=SUCCEEDED")
      .then((p) => setItems(p.items))
      .catch((e: Error) => setError(e.message));
  }, [open, items]);
  const tiles = (items ?? []).flatMap((j) => j.resultUrls.map((url) => ({ url, prompt: j.prompt })));
  return (
    <Modal open={open} onClose={onClose} title="Chọn ảnh đã tạo" size="lg">
      {error && <p className="text-sm text-danger">{error}</p>}
      {!items && !error && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skel aspect-square rounded-m1" />
          ))}
        </div>
      )}
      {items && tiles.length === 0 && <Empty icon="image" title="Chưa có ảnh nào" />}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {tiles.map((t, i) => (
          <button
            key={t.url}
            type="button"
            onClick={() => {
              onPick(t.url);
              onClose();
            }}
            className="press reveal group relative aspect-square overflow-hidden rounded-m1 bg-s2 hairline"
            style={{ "--i": i } as React.CSSProperties}
          >
            <img src={t.url} alt={t.prompt} loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          </button>
        ))}
      </div>
    </Modal>
  );
}

// Ô ảnh tham chiếu / khung đầu trong composer.
export function RefSlot({
  value,
  onChange,
  onBusyChange,
  label,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  onBusyChange?: (b: boolean) => void;
  label: string;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [drag, setDrag] = useState(false);

  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true);
    onBusyChange?.(true);
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input ref={input} type="file" accept={TYPES.join(",")} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {value ? (
        <div className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-m1 hairline">
          <img src={value} alt={label} className="h-full w-full object-cover" />
          <button
            type="button"
            aria-label={`Bỏ ${label.toLowerCase()}`}
            onClick={() => onChange(null)}
            className="press absolute inset-0 flex items-center justify-center bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:bg-black/35"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
      ) : (
        <Popover
          side="top"
          trigger={({ toggle, ref, ...aria }) => (
            <button
              ref={ref}
              type="button"
              onClick={toggle}
              {...aria}
              aria-label={label}
              data-tip={label}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                onFile(e.dataTransfer.files?.[0]);
              }}
              className={cx(
                "press flex h-14 w-14 shrink-0 items-center justify-center rounded-m1 border border-dashed text-muted hover:border-white/30 hover:text-fg",
                drag ? "border-accent bg-accent/10 text-accent" : "border-white/15 bg-white/[.03]",
              )}
            >
              {busy ? <Spinner /> : <Icon name="plus" size={20} />}
            </button>
          )}
        >
          {(close) => (
            <div className="w-56">
              <p className="px-2.5 pt-1.5 pb-1 t-label">{label}</p>
              <MenuItem
                icon={<Icon name="upload" size={17} />}
                onClick={() => {
                  close();
                  input.current?.click();
                }}
              >
                Tải ảnh lên
              </MenuItem>
              <MenuItem
                icon={<Icon name="library" size={17} />}
                onClick={() => {
                  close();
                  setPicker(true);
                }}
              >
                Chọn ảnh đã tạo
              </MenuItem>
            </div>
          )}
        </Popover>
      )}
      <LibraryImagePicker open={picker} onClose={() => setPicker(false)} onPick={onChange} />
    </>
  );
}
