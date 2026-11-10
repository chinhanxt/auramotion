"use client";

import { useEffect, useRef, useState } from "react";
import { isNotFound, postJson, prewriteSkillName, type PrewriteRequest, type PrewriteResult } from "@/lib/api-client";

export type PrewriteState = { status: "idle" | "writing" | "ready"; prompt?: string; provider?: string; skillName?: string };

const DEBOUNCE_MS = 900;
const POLL_MS = 1500;
const MIN_IDEA = 8;

// Viết trước khi người dùng ngừng gõ: cùng tham số với job → bấm Tạo backend lấy từ cache.
// Tối đa 1 request; tham số đổi thì hủy cái cũ; backend chưa có API (404) thì tắt hẳn.
export function usePrewrite(req: PrewriteRequest | null): PrewriteState {
  const [state, setState] = useState<PrewriteState>({ status: "idle" });
  const off = useRef(false);
  const key = req && req.idea.trim().length >= MIN_IDEA ? JSON.stringify({ ...req, idea: req.idea.trim() }) : null;

  useEffect(() => {
    setState({ status: "idle" });
    if (!key || off.current) return;
    const body = JSON.parse(key) as PrewriteRequest;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const ask = async () => {
      try {
        const r = await postJson<PrewriteResult>("/api/ai/prewrite", body, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (r.status === "ready" && r.prompt) {
          setState({ status: "ready", prompt: r.prompt, provider: r.provider, skillName: prewriteSkillName(r) });
          return;
        }
        setState((s) => (s.status === "writing" ? s : { status: "writing", provider: r.provider, skillName: prewriteSkillName(r) }));
        timer = setTimeout(ask, POLL_MS);
      } catch (err) {
        if ((err as Error).name === "AbortError" || ctrl.signal.aborted) return;
        if (isNotFound(err)) off.current = true;
        setState({ status: "idle" });
      }
    };
    timer = setTimeout(() => {
      setState({ status: "writing" });
      void ask();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);

  return state;
}
