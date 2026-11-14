"use client";

import { useEffect, useState } from "react";
import { api, apiCached, postJson, type Catalog, type CatalogModel, type CatalogPreset, type CatalogSkill, type CatalogPlan } from "@/lib/api-client";

export type StoryCatalog = {
  skills: CatalogSkill[];
  styles: CatalogPreset[];
  cameras: CatalogPreset[];
  videoModel: CatalogModel | null;
  plan: CatalogPlan | null;
  ratios: string[];
  videoUnavailable: boolean;
};

// `/api/catalog?kind=story` (v2). Backend cũ chưa có thì ghép từ catalog ảnh + video.
export function useStoryCatalog() {
  const [cat, setCat] = useState<StoryCatalog | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [story, image, video] = await Promise.all([
        apiCached<Catalog>("/api/catalog?kind=story").catch(() => null),
        apiCached<Catalog>("/api/catalog?kind=image").catch(() => null),
        apiCached<Catalog>("/api/catalog?kind=video").catch(() => null),
      ]);
      if (cancelled) return;
      const presets = [...(story?.presets ?? []), ...(image?.presets ?? []), ...(video?.presets ?? [])].filter(
        (p, i, all) => all.findIndex((x) => x.id === p.id) === i,
      );
      const videoModel = (video?.models ?? []).find((m) => !m.locked) ?? video?.models[0] ?? null;
      setCat({
        skills: [...(story?.skills ?? []), ...(video?.skills ?? [])].filter((s, i, all) => s.kind === "STORY" && all.findIndex((x) => x.id === s.id) === i),
        styles: presets.filter((p) => p.kind === "STYLE"),
        cameras: presets.filter((p) => p.kind === "CAMERA"),
        videoModel,
        plan: video?.plan ?? image?.plan ?? null,
        ratios: videoModel?.options.aspectRatios?.length ? videoModel.options.aspectRatios : ["9:16", "16:9", "1:1"],
        videoUnavailable: Boolean(video?.videoUnavailable || story?.videoUnavailable),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return cat;
}

// Giá quay 1 cảnh (báo giá job video) × số cảnh.
export function useShotQuote(model: CatalogModel | null, aspect: string, durationSec: number, shots: number) {
  const [perShot, setPerShot] = useState<number | null>(null);
  useEffect(() => {
    if (!model || !aspect) return;
    const ctl = new AbortController();
    setPerShot(null);
    const t = setTimeout(() => {
      postJson<{ cost: number }>("/api/jobs/quote", { kind: "video", modelId: model.id, prompt: "-", aspectRatio: aspect, durationSec }, ctl.signal)
        .then((r) => setPerShot(r.cost))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [model, aspect, durationSec]);
  return perShot === null ? null : perShot * shots;
}
