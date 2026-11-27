"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Play } from "lucide-react";
import { videoEmbedUrl, type LessonVideo } from "@/lib/lesson-video";

/**
 * A lesson video behind a click-to-load facade: nothing is requested from the video's host (no frame, thumbnail or script) until the learner presses
 * play. The frame then loads the privacy-friendly embed address built from the stored provider and id only, with autoplay, a sandbox and the origin
 * as the only referrer.
 */
export function LessonVideoPlayer({ video, title }: { video: LessonVideo; title: string }) {
  const t = useTranslations("CatalogPublic");
  const [playing, setPlaying] = useState(false);
  const src = videoEmbedUrl(video);
  if (!src) return null;
  if (playing) return <div className="aspect-video w-full overflow-hidden rounded-lg border bg-muted">
    <iframe src={src} title={t("videoTitle", { title })} className="size-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
      referrerPolicy="strict-origin" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" data-lesson-video-frame />
  </div>;
  return <div className="space-y-2">
    <button type="button" onClick={() => setPlaying(true)} data-lesson-video-facade
      className="group flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border bg-muted text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm"><Play className="size-7 translate-x-0.5" /></span>
      <span className="text-sm font-medium">{t("playVideo")}</span>
    </button>
    <p className="text-xs text-muted-foreground">{t("videoNotice")}</p>
  </div>;
}
