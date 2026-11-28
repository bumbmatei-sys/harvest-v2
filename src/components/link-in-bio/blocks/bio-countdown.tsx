/** Derived from Shadcn UI Kit item product-cards5 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

const parts = (ms: number) => ({ days: Math.floor(ms / 86_400_000), hours: Math.floor(ms / 3_600_000) % 24, minutes: Math.floor(ms / 60_000) % 60, seconds: Math.floor(ms / 1000) % 60 });

/**
 * Countdown: a days, hours, minutes and seconds bar to a moment, with the date written out for screen readers and before the page runs scripts. Once the
 * moment has passed it says so and shows the owner's link when there is one. The numbers tick once a second and are not announced.
 */
export function BioCountdown({ title, at, url, inert }: { title: string; at: string; url: string; inert?: { tabIndex?: number; onClick?: (event: React.MouseEvent) => void } }) {
  const t = useTranslations("LinkInBio.public"), format = useFormatter();
  const target = Date.parse(at);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const first = setTimeout(() => setNow(Date.now()), 0), timer = setInterval(() => setNow(Date.now()), 1000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);
  const left = now === null ? null : Math.max(0, target - now), started = left === 0;
  const when = Number.isNaN(target) ? "" : format.dateTime(new Date(target), { dateStyle: "medium", timeStyle: "short" });
  return <section aria-label={title} className="space-y-3 rounded-xl border bg-card p-4 text-card-foreground" data-bio-countdown>
    <div><h2 className="break-words text-base font-semibold">{title}</h2><p className="text-sm text-muted-foreground"><time dateTime={at}>{when}</time></p></div>
    {started ? <p className="text-sm font-medium" data-bio-countdown-started>{t("countdownStarted")}</p>
      : <div className="grid grid-cols-4 gap-2 rounded-lg bg-primary px-3 py-2 text-primary-foreground" aria-hidden="true" data-bio-countdown-bar>
        {(["days", "hours", "minutes", "seconds"] as const).map((key) => <div key={key} className="flex flex-col items-center">
          <span className="text-xl font-bold leading-none tabular-nums">{String(left === null ? 0 : parts(left)[key]).padStart(2, "0")}</span>
          <span className="mt-0.5 text-xs font-medium">{t(`countdown.${key}`)}</span></div>)}
      </div>}
    {started && url && <a href={url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert}
      className="inline-flex min-h-11 items-center gap-2 rounded-md border px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {t("countdownOpen")}<ExternalLink className="size-4" aria-hidden="true" /><span className="sr-only">{t("openLink")}</span></a>}
  </section>;
}
