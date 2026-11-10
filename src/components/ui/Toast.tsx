"use client";

import Link from "next/link";
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./Button";
import { cx } from "./cx";
import { Icon } from "./Icon";

export type ToastKind = "success" | "error" | "info" | "loading";
export type ToastAction = { label: string; href?: string; onClick?: () => void };
export type ToastInput = {
  kind?: ToastKind;
  title: React.ReactNode;
  body?: React.ReactNode;
  thumb?: { url: string; video?: boolean };
  action?: ToastAction;
  duration?: number;
  id?: string;
};
type Toast = ToastInput & { id: string; kind: ToastKind; leaving?: boolean };

type ToastApi = {
  show: (t: ToastInput) => string;
  success: (title: React.ReactNode, rest?: Partial<ToastInput>) => string;
  error: (title: React.ReactNode, rest?: Partial<ToastInput>) => string;
  info: (title: React.ReactNode, rest?: Partial<ToastInput>) => string;
  loading: (title: React.ReactNode, rest?: Partial<ToastInput>) => string;
  update: (id: string, t: Partial<ToastInput>) => void;
  dismiss: (id: string) => void;
  promise: <T>(p: Promise<T>, msg: { loading: React.ReactNode; success: React.ReactNode | ((v: T) => React.ReactNode); error?: (e: Error) => React.ReactNode }) => Promise<T>;
};

const Ctx = createContext<ToastApi | null>(null);
const DEFAULT_MS = 4000;
const MAX = 4;
let seq = 0;

export function useToast(): ToastApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useToast cần ToastProvider");
  return v;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: string) => {
    setList((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 220);
    const tm = timers.current.get(id);
    if (tm) clearTimeout(tm);
    timers.current.delete(id);
  }, []);

  const arm = useCallback(
    (t: Toast) => {
      const old = timers.current.get(t.id);
      if (old) clearTimeout(old);
      if (t.kind === "loading") return;
      timers.current.set(
        t.id,
        setTimeout(() => remove(t.id), t.duration ?? (t.kind === "error" ? 6000 : DEFAULT_MS)),
      );
    },
    [remove],
  );

  const show = useCallback(
    (input: ToastInput) => {
      const id = input.id ?? `t${++seq}`;
      const t: Toast = { ...input, id, kind: input.kind ?? "info" };
      setList((l) => [...l.filter((x) => x.id !== id), t].slice(-MAX));
      arm(t);
      return id;
    },
    [arm],
  );

  const update = useCallback(
    (id: string, patch: Partial<ToastInput>) => {
      setList((l) =>
        l.map((t) => {
          if (t.id !== id) return t;
          const next = { ...t, ...patch, kind: patch.kind ?? t.kind } as Toast;
          arm(next);
          return next;
        }),
      );
    },
    [arm],
  );

  const api = useMemo<ToastApi>(() => {
    const mk = (kind: ToastKind) => (title: React.ReactNode, rest: Partial<ToastInput> = {}) => show({ ...rest, kind, title });
    return {
      show,
      update,
      dismiss: remove,
      success: mk("success"),
      error: mk("error"),
      info: mk("info"),
      loading: mk("loading"),
      async promise(p, msg) {
        const id = show({ kind: "loading", title: msg.loading });
        try {
          const v = await p;
          update(id, { kind: "success", title: typeof msg.success === "function" ? (msg.success as (v: unknown) => React.ReactNode)(v) : msg.success });
          return v;
        } catch (e) {
          update(id, { kind: "error", title: msg.error ? msg.error(e as Error) : (e as Error).message });
          throw e;
        }
      },
    };
  }, [show, update, remove]);

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="am-layer pointer-events-none fixed inset-x-0 top-[calc(10px+var(--safe-t))] z-[90] flex flex-col items-center gap-2 px-3 sm:top-auto sm:right-5 sm:bottom-5 sm:left-auto sm:items-end sm:px-0"
      >
        {list.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  );
}

const ICON: Record<Exclude<ToastKind, "loading">, { name: "check" | "alert" | "info"; cls: string }> = {
  success: { name: "check", cls: "bg-accent text-accent-ink" },
  error: { name: "alert", cls: "bg-danger/20 text-danger" },
  info: { name: "info", cls: "bg-white/10 text-fg" },
};

const ToastCard = memo(function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);

  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      onPointerDown={(e) => {
        start.current = e.clientX;
      }}
      onPointerMove={(e) => start.current !== null && setDx(e.clientX - start.current)}
      onPointerUp={() => {
        if (Math.abs(dx) > 80) onClose();
        else setDx(0);
        start.current = null;
      }}
      onPointerCancel={() => {
        setDx(0);
        start.current = null;
      }}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined, opacity: dx ? Math.max(0.2, 1 - Math.abs(dx) / 240) : undefined }}
      className={cx(
        "toast pointer-events-auto flex w-full max-w-[380px] touch-pan-y items-center gap-3 rounded-m2 p-2.5 pr-2 glass-strong shadow-[0_0_0_1px_var(--color-line2),0_20px_50px_-12px_rgba(0,0,0,.8)] select-none",
        toast.leaving && "toast-leave",
      )}
    >
      {toast.thumb ? (
        <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[10px] bg-s3">
          {toast.thumb.video ? (
            <video src={`${toast.thumb.url}#t=0.1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
          ) : (
            <img src={toast.thumb.url} alt="" className="h-full w-full object-cover" />
          )}
        </span>
      ) : (
        <span
          className={cx(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
            toast.kind === "loading" ? "bg-white/10 text-fg" : ICON[toast.kind].cls,
          )}
        >
          {toast.kind === "loading" ? <Spinner /> : <Icon name={ICON[toast.kind].name} size={16} strokeWidth={2} />}
        </span>
      )}
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm leading-snug font-semibold">{toast.title}</p>
        {toast.body && <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted">{toast.body}</p>}
      </div>
      {toast.action &&
        (toast.action.href ? (
          <Link
            href={toast.action.href}
            onClick={() => {
              toast.action?.onClick?.();
              onClose();
            }}
            className="press shrink-0 rounded-[10px] bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-ink"
          >
            {toast.action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => {
              toast.action?.onClick?.();
              onClose();
            }}
            className="press shrink-0 rounded-[10px] bg-white/10 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/15"
          >
            {toast.action.label}
          </button>
        ))}
      <button type="button" aria-label="Đóng thông báo" onClick={onClose} className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-fg">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
});
