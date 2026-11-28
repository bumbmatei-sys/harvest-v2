/** Derived from Shadcn UI Kit item profile-block2 (free), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { NetworkMark } from "@/components/link-in-bio/bio-icons";
import type { BioView } from "@/lib/link-in-bio";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "·";

/**
 * The top of a link in bio page (founder decision 27 Nov): the round profile photo (left or centre, overlapping the cover band `BioCover` when there is one),
 * the name, a one-line short bio and one row of social and website icons in a single style. Nothing else sits in the header; everything else is a block.
 * Sizes by its container, so the editor's phone preview and a phone match.
 */
export function BioCover({ cover }: { cover: string | null }) {
  return <div className="relative h-32 w-full overflow-hidden border-b bg-gradient-to-br from-primary/70 via-primary/40 to-secondary @md:h-40" data-bio-cover={cover ? "image" : "gradient"} aria-hidden="true">
    {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
    {cover && <img src={cover} alt="" className="size-full object-cover" />}
  </div>;
}

export function BioHeader({ view, photo, preview, Title }: { view: BioView; photo: string | null; preview: boolean; Title: "h1" | "h2" }) {
  const t = useTranslations("LinkInBio.public");
  const centre = view.photoAlign === "center";
  const inert = preview ? { tabIndex: -1, onClick: (event: React.MouseEvent) => event.preventDefault() } : {};
  return <>
    <header className={cn("relative z-10 flex flex-col gap-4", view.showCover ? "-mt-12" : "pt-8", centre ? "items-center text-center" : "items-start text-left @md:flex-row @md:items-end")} data-bio-align={view.photoAlign}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect from the server, not optimisable */}
      {photo ? <img src={photo} alt={t("photoAlt", { name: view.name })} className="size-24 shrink-0 rounded-full bg-muted object-cover ring-4 ring-background" data-bio-photo />
        : <span className="flex size-24 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground ring-4 ring-background" aria-hidden="true" data-bio-initials>{initials(view.name)}</span>}
      <div className={cn("min-w-0 space-y-1", !centre && "@md:flex-1 @md:pb-1")}>
        <Title className="break-words text-2xl font-semibold tracking-tight">{view.name}</Title>
        {view.bio && <p className="break-words text-sm text-muted-foreground" data-bio-line>{view.bio}</p>}
      </div>
    </header>
    {view.socials.length > 0 && <ul className={cn("flex flex-wrap gap-2", centre ? "justify-center" : "justify-start")} data-bio-socials data-bio-icon-style={view.iconStyle}>{view.socials.map((social) => <li key={social.network}>
      <a href={social.url} target="_blank" rel="nofollow noopener noreferrer ugc" {...inert} aria-label={t("socialLabel", { name: view.name, network: t(`networks.${social.network}`) })}
        className="flex size-11 items-center justify-center rounded-full border bg-card text-card-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <NetworkMark network={social.network} colored={view.iconStyle === "color"} /></a></li>)}</ul>}
  </>;
}
