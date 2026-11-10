"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api-client";

export function jsonInit(method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): RequestInit {
  return body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

// Gọi API có toast (đang xử lý → xong / lỗi) và cờ bận theo khóa (vd id dòng).
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, msg: { loading?: string; success?: string | ((v: T) => string); silent?: boolean } = {}) => {
      setBusy((b) => ({ ...b, [key]: true }));
      const id = msg.loading ? toast.loading(msg.loading) : null;
      try {
        const v = await fn();
        const title = typeof msg.success === "function" ? msg.success(v) : msg.success;
        if (id) toast.update(id, { kind: "success", title: title ?? "Xong" });
        else if (title && !msg.silent) toast.success(title);
        return v;
      } catch (err) {
        const title = (err as Error).message || "Có lỗi xảy ra";
        if (id) toast.update(id, { kind: "error", title });
        else toast.error(title);
        return undefined;
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[key];
          return next;
        });
      }
    },
    [toast],
  );
  return { run, busy, isBusy: (key: string) => Boolean(busy[key]) };
}

// Gọi GET định kỳ; tạm dừng khi tab ẩn, gọi lại ngay khi tab hiện.
export function usePoll<T>(url: string | null, intervalMs = 0, initial?: T) {
  const [data, setData] = useState<T | undefined>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initial === undefined);
  const [at, setAt] = useState<number | null>(initial === undefined ? null : Date.now());
  const ctrl = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (!url) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    try {
      const v = await api<T>(url, { signal: c.signal, cache: "no-store" });
      setData(v);
      setError(null);
      setAt(Date.now());
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      if (ctrl.current === c) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    if (initial === undefined) void refresh();
    if (!intervalMs) return () => ctrl.current?.abort();
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => void refresh(), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const onVis = () => {
      if (document.hidden) stop();
      else {
        void refresh();
        start();
      }
    };
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
      ctrl.current?.abort();
    };
    // initial chỉ dùng lần đầu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, intervalMs, refresh]);

  return { data, setData, error, loading, refresh, at };
}

// Giữ bản nháp của form; `dirty` khi khác bản gốc.
export function useDraft<T>(source: T) {
  const [draft, setDraft] = useState<T>(source);
  const [base, setBase] = useState<T>(source);
  useEffect(() => {
    setDraft(source);
    setBase(source);
  }, [source]);
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => setDraft((d) => ({ ...d, [key]: value })), []);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  return { draft, setDraft, set, dirty, reset: () => setDraft(base), commit: (v: T) => (setBase(v), setDraft(v)) };
}
