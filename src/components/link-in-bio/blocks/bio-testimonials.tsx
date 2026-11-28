/** Derived from Shadcn UI Kit item testimonial11 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] ?? "").join("").toUpperCase() || "·";

/** Testimonials: quote cards with the person's initials, name and role; two columns on wide screens, one on a phone. No photos and no animation. */
export function BioTestimonials({ items }: { items: { id: string; quote: string; name: string; role: string }[] }) {
  const t = useTranslations("LinkInBio.public");
  return <section aria-label={t("testimonialsLabel")} className="grid gap-3 @md:grid-cols-2" data-bio-testimonials>
    {items.map((item) => <figure key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground">
      <figcaption className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground" aria-hidden="true">{initials(item.name)}</span>
        <span className="min-w-0"><span className="block break-words font-medium">{item.name}</span>{item.role && <span className="block break-words text-sm text-muted-foreground">{item.role}</span>}</span>
      </figcaption>
      <blockquote className="whitespace-pre-line break-words leading-relaxed text-muted-foreground">{item.quote}</blockquote>
    </figure>)}
  </section>;
}
