"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { ACTIVE_STATUSES, api, formatCredit, isVideoUrl, jobErrorText, type JobEvent, type StoryEvent } from "@/lib/api-client";

// Một kết nối SSE `/api/events` cho cả app (hợp đồng v2 §3). Khi SSE chưa có (404) hoặc đang mất kết nối,
// `live` = false và các danh sách tự poll như cũ; kết quả poll cũng được phát lại qua `emit` để mọi nơi cập nhật chung.

type EventMap = { job: JobEvent; story: StoryEvent; credit: { balance: number | string } };
type Name = keyof EventMap;
type Listener<K extends Name> = (data: EventMap[K]) => void;

type Bus = {
  live: boolean;
  subscribe: <K extends Name>(name: K, fn: Listener<K>) => () => void;
  emit: <K extends Name>(name: K, data: EventMap[K]) => void;
  balance: number | null;
  held: number;
  refreshCredit: () => void;
};

const Ctx = createContext<Bus | null>(null);

function useBus(): Bus {
  const v = useContext(Ctx);
  if (!v) throw new Error("Cần EventsProvider");
  return v;
}

const MAX_BACKOFF = 30_000;
const PROBE_AGAIN_MS = 120_000;
const SSE_MISSING_KEY = "am:sse-missing";

export function EventsProvider({ children, initialBalance, initialHeld = 0 }: { children: React.ReactNode; initialBalance: number; initialHeld?: number }) {
  const toast = useToast();
  const listeners = useRef(new Map<Name, Set<Listener<Name>>>());
  const [live, setLive] = useState(false);
  const [balance, setBalance] = useState<number | null>(initialBalance);
  const [held, setHeld] = useState(initialHeld);
  const lastStatus = useRef(new Map<string, string>());
  const creditTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshCredit = useCallback(() => {
    if (creditTimer.current) clearTimeout(creditTimer.current);
    creditTimer.current = setTimeout(() => {
      api<{ balance: { available: string; held: string } }>("/api/credits")
        .then((d) => {
          setBalance(Number(d.balance.available));
          setHeld(Number(d.balance.held));
        })
        .catch(() => {});
    }, 400);
  }, []);

  const dispatch = useCallback(<K extends Name>(name: K, data: EventMap[K]) => {
    listeners.current.get(name)?.forEach((fn) => (fn as Listener<K>)(data));
  }, []);

  // Job vừa xong / lỗi → toast (mỗi job một lần).
  const onJob = useCallback(
    (j: JobEvent) => {
      const prev = lastStatus.current.get(j.id);
      lastStatus.current.set(j.id, j.status);
      if (prev === j.status || ACTIVE_STATUSES.includes(j.status)) return;
      if (prev && !ACTIVE_STATUSES.includes(prev as JobEvent["status"])) return;
      if (j.storyId) return; // cảnh của story: trang story tự hiện, không spam toast
      const url = j.resultUrls?.[0];
      if (j.status === "SUCCEEDED") {
        toast.success(j.kind === "IMAGE" ? "Ảnh đã xong" : j.kind === "ASSEMBLE" ? "Video ghép đã xong" : "Video đã xong", {
          thumb: url ? { url, video: isVideoUrl(url) || j.kind !== "IMAGE" } : undefined,
          action: { label: "Xem", href: `/library/${j.id}` },
          duration: 6000,
        });
      } else if (j.status === "FAILED") {
        // WRITE_FAILED: câu lỗi đã gồm "đã hoàn Credit".
        const why = j.error ? jobErrorText(j.error) : "có lỗi";
        toast.error("Tạo thất bại", { body: j.error === "WRITE_FAILED" ? why : `${why} · đã hoàn Credit` });
      }
    },
    [toast],
  );

  const emit = useCallback(
    <K extends Name>(name: K, data: EventMap[K]) => {
      if (name === "job") {
        onJob(data as JobEvent);
        if (!ACTIVE_STATUSES.includes((data as JobEvent).status)) refreshCredit();
      }
      if (name === "credit") setBalance(Number((data as EventMap["credit"]).balance));
      dispatch(name, data);
    },
    [dispatch, onJob, refreshCredit],
  );

  const emitRef = useRef(emit);
  emitRef.current = emit;

  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let stopped = false;

    const parse = <K extends Name>(name: K) => (e: MessageEvent) => {
      try {
        emitRef.current(name, JSON.parse(e.data) as EventMap[K]);
      } catch {
        // gói tin hỏng: bỏ qua
      }
    };

    const schedule = (ms: number) => {
      if (stopped) return;
      timer = setTimeout(connect, ms);
    };

    function connect() {
      es = new EventSource("/api/events");
      let opened = false;
      es.onopen = () => {
        opened = true;
        backoff = 1000;
        setLive(true);
      };
      es.addEventListener("job", parse("job"));
      es.addEventListener("story", parse("story"));
      es.addEventListener("credit", parse("credit"));
      es.onerror = async () => {
        setLive(false);
        es?.close();
        es = null;
        if (stopped) return;
        if (!opened) {
          // Chưa từng mở: kiểm route có tồn tại không (404 → dùng poll, thử lại sau lâu).
          const res = await fetch("/api/events", { method: "GET", headers: { Accept: "text/event-stream" } }).catch(() => null);
          res?.body?.cancel().catch(() => {});
          if (!res || res.status === 404 || res.status === 405 || res.status === 401) {
            try {
              sessionStorage.setItem(SSE_MISSING_KEY, String(Date.now()));
            } catch {
              // trình duyệt chặn storage
            }
            return schedule(PROBE_AGAIN_MS);
          }
        }
        schedule(backoff);
        backoff = Math.min(MAX_BACKOFF, backoff * 2);
      };
    }

    let missingAt = 0;
    try {
      missingAt = Number(sessionStorage.getItem(SSE_MISSING_KEY) ?? 0);
    } catch {
      // bỏ qua
    }
    const wait = missingAt ? PROBE_AGAIN_MS - (Date.now() - missingAt) : 0;
    if (wait > 0) schedule(wait);
    else connect();
    const onVisible = () => {
      if (document.visibilityState === "visible" && !es && timer) {
        clearTimeout(timer);
        connect();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      es?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const subscribe = useCallback(<K extends Name>(name: K, fn: Listener<K>) => {
    let set = listeners.current.get(name);
    if (!set) listeners.current.set(name, (set = new Set()));
    set.add(fn as Listener<Name>);
    return () => {
      set.delete(fn as Listener<Name>);
    };
  }, []);

  const value = useMemo<Bus>(() => ({ live, subscribe, emit, balance, held, refreshCredit }), [live, subscribe, emit, balance, held, refreshCredit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// Nghe sự kiện job; `fn` có thể đổi mỗi render mà không đăng ký lại.
export function useJobEvents(fn: (e: JobEvent) => void) {
  const { subscribe } = useBus();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe("job", (e) => ref.current(e)), [subscribe]);
}

export function useStoryEvents(fn: (e: StoryEvent) => void) {
  const { subscribe } = useBus();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe("story", (e) => ref.current(e)), [subscribe]);
}

export function useCreditBalance() {
  const { balance, held, refreshCredit } = useBus();
  return { balance, held, refresh: refreshCredit, label: balance === null ? "—" : formatCredit(balance) };
}

export function useRealtime() {
  const { live, emit } = useBus();
  return { live, emit };
}
