"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** Picks the frame of a video used as its cover: scrub a slider and the still shown is the frame the destination receives (an offset in milliseconds). */
export function CoverFramePicker({ src, valueMs, onChange }: { src: string; valueMs: number | null; onChange: (ms: number | null) => void }) {
  const t = useTranslations("SocialPublish.destination"), video = useRef<HTMLVideoElement>(null), [duration, setDuration] = useState(0);
  const seconds = (valueMs ?? 0) / 1000;
  useEffect(() => { if (video.current && Math.abs(video.current.currentTime - seconds) > 0.05) video.current.currentTime = seconds; }, [seconds]);
  return <div className="space-y-2">
    <video ref={video} src={`${src}#t=0.1`} muted playsInline preload="metadata" aria-hidden="true" onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)} className="aspect-video max-h-40 rounded-md bg-muted object-contain" />
    {duration > 0 && <label className="flex min-h-11 items-center gap-3 text-sm sm:min-h-9">
      <span className="shrink-0">{t("coverFrame")}</span>
      <input type="range" min={0} max={Math.max(0, Math.floor((duration - 0.1) * 1000))} step={100} value={valueMs ?? 0} aria-label={t("coverFrame")}
        onChange={(event) => onChange(Number(event.target.value))} className="min-h-11 w-full accent-primary sm:min-h-6" />
      <span className="w-14 shrink-0 text-right tabular-nums">{t("seconds", { value: seconds.toFixed(1) })}</span>
    </label>}
  </div>;
}
