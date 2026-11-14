"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteSentinel } from "@/components/library/useJobFeed";
import { useRealtime, useStoryEvents } from "@/components/realtime/Events";
import { AuraBar, Badge, Empty, Notice } from "@/components/ui/Bits";
import { Spinner } from "@/components/ui/Button";
import { SmartVideo } from "@/components/ui/Media";
import { thumbUrl } from "@/lib/media-url";
import { STORY_ACTIVE, STORY_STATUS_LABEL, api, isNotFound, isVideoUrl, type StoryItem, type StoryStatus } from "@/lib/api-client";

type Page = { items: StoryItem[]; nextCursor: string | null };

export const STORY_TONE: Record<StoryStatus, "warn" | "info" | "ok" | "danger" | "neutral" | "aura"> = {
  PLANNING: "aura",
  READY: "info",
  RENDERING: "aura",
  ASSEMBLING: "aura",
  DONE: "ok",
  FAILED: "danger",
  CANCELED: "neutral",
};

const StoryCard = memo(function StoryCard({ story, order }: { story: StoryItem; order: number }) {
  const active = STORY_ACTIVE.includes(story.status);
  return (
    <Link
      href={`/studio/story/${story.id}`}
      className="reveal lift group relative block overflow-hidden rounded-m3 bg-s1 hairline"
      style={{ "--i": order } as React.CSSProperties}
    >
      <div className="relative overflow-hidden bg-s2" style={{ aspectRatio: "16 / 10" }}>
        {story.cover ? (
          isVideoUrl(story.cover) ? (
            <SmartVideo src={story.cover} mode="hover" hovering className="absolute inset-0" />
          ) : (
            <img src={thumbUrl(story.cover, 480)} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          )
        ) : (
          <div className={active ? "skel skel-aura absolute inset-0" : "absolute inset-0 bg-[radial-gradient(90%_80%_at_20%_10%,rgba(124,92,255,.35),transparent_60%),radial-gradient(80%_80%_at_90%_90%,rgba(255,79,216,.25),transparent_60%)]"} />
        )}
        <div className="absolute inset-x-0 bottom-0 flex gap-1 p-3">
          {Array.from({ length: Math.min(8, story.shotCount) }, (_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full bg-white/25" />
          ))}
        </div>
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={STORY_TONE[story.status]} dot={active}>
            {STORY_STATUS_LABEL[story.status]}
          </Badge>
          <span className="text-xs text-muted">
            {story.shotCount} cảnh · {story.aspect}
          </span>
        </div>
        <p className="line-clamp-1 text-[15px] font-semibold">{story.title || "Story chưa đặt tên"}</p>
        <p className="line-clamp-2 text-[13px] leading-snug text-muted">{story.idea}</p>
        {active && <AuraBar />}
      </div>
    </Link>
  );
});

export function StoryGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-m3 bg-s1 hairline">
          <div className="skel" style={{ aspectRatio: "16 / 10" }} />
          <div className="space-y-2.5 p-4">
            <div className="skel h-5 w-24 rounded-full" />
            <div className="skel h-4 w-2/3 rounded-full" />
            <div className="skel h-3 w-full rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function StoryGrid({ refreshKey = 0 }: { refreshKey?: number }) {
  const { live } = useRealtime();
  const [items, setItems] = useState<StoryItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [more, setMore] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    api<Page>("/api/stories")
      .then((p) => {
        setItems(p.items);
        setCursor(p.nextCursor);
      })
      .catch((e) => (isNotFound(e) ? setMissing(true) : setError((e as Error).message)));
  }, [refreshKey]);

  const loadMore = useCallback(async () => {
    if (!cursor || more) return;
    setMore(true);
    try {
      const p = await api<Page>(`/api/stories?cursor=${encodeURIComponent(cursor)}`);
      setItems((l) => [...(l ?? []), ...p.items.filter((s) => !(l ?? []).some((x) => x.id === s.id))]);
      setCursor(p.nextCursor);
    } finally {
      setMore(false);
    }
  }, [cursor, more]);
  const sentinel = useInfiniteSentinel(loadMore, Boolean(cursor) && !more, items?.length);

  useStoryEvents((e) => setItems((l) => l && l.map((s) => (s.id === e.id ? { ...s, status: e.status, plan: e.plan ?? s.plan, error: e.error ?? s.error } : s))));

  // Không có SSE: làm mới danh sách khi còn story đang chạy.
  useEffect(() => {
    if (live) return;
    const t = setInterval(() => {
      if (!itemsRef.current?.some((s) => STORY_ACTIVE.includes(s.status)) || document.visibilityState === "hidden") return;
      api<Page>("/api/stories")
        .then((p) => setItems((l) => (l ? l.map((s) => p.items.find((x) => x.id === s.id) ?? s) : p.items)))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(t);
  }, [live]);

  if (missing) return <Empty icon="story" title="Story sắp có" hint="Máy chủ chưa bật tính năng Story." />;
  if (error) return <Notice tone="danger">{error}</Notice>;
  if (!items) return <StoryGridSkeleton />;
  if (items.length === 0) return <Empty icon="story" title="Chưa có story nào" />;
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {items.map((s, i) => (
          <StoryCard key={s.id} story={s} order={i % 12} />
        ))}
      </div>
      <div ref={sentinel} className="flex h-16 items-center justify-center text-muted">
        {more && <Spinner />}
      </div>
    </>
  );
}
