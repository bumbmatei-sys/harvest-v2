/** Derived from Shadcn UI Kit item contact10 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { MapPin, Navigation } from "lucide-react";
import { mapsHref } from "@/lib/link-in-bio";

/** Location: a labelled address row and an "Open in maps" button. No map is embedded and nothing is requested from a map service until the visitor taps. */
export function BioLocation({ label, address, onOpen, inert }: { label: string; address: string; onOpen?: (event: React.MouseEvent) => void; inert?: { tabIndex?: number } }) {
  const t = useTranslations("LinkInBio.public");
  return <section aria-label={label || t("locationLabel")} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground @md:flex-row @md:items-center" data-bio-location>
    <MapPin className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
    <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{label || t("locationLabel")}</p><address className="whitespace-pre-line break-words text-sm not-italic text-muted-foreground">{address}</address></div>
    <a href={mapsHref(address)} target="_blank" rel="nofollow noopener noreferrer" {...inert} onClick={onOpen}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
      <Navigation className="size-4" aria-hidden="true" />{t("openInMaps")}<span className="sr-only">{t("openLink")}</span></a>
  </section>;
}
