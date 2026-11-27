/** Layout reference: Shadcn UI Kit item blog-card1 (premium, founder-approved 27 Nov 2026), used as a layout reference only; Harvest code, theme tokens and catalogue copy. Notes: docs/ui-sources.md. */
/* eslint-disable @next/next/no-img-element -- pictures are short signed redirects from the server, not optimisable */
import Link from "next/link";
import { CalendarDays, Clock, Newspaper } from "lucide-react";
import { cn } from "@/lib/utils";

export type BlogCardData = { href: string; title: string; excerpt: string; date: string; dateTime: string; minutes?: string; coverUrl: string | null };

/** One article card: picture (or a quiet placeholder), title, excerpt, date and reading time. The whole card is one link with a 44px+ target. */
export function BlogArticleCard({ card, headingLevel = 2, className }: { card: BlogCardData; headingLevel?: 2 | 3; className?: string }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <article className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs transition-colors hover:bg-accent/40", className)} data-blog-card>
    <div className="aspect-[16/9] w-full overflow-hidden bg-muted">
      {card.coverUrl ? <img src={card.coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        : <div className="flex size-full items-center justify-center text-muted-foreground"><Newspaper className="size-8" aria-hidden="true" /></div>}
    </div>
    <div className="flex flex-1 flex-col gap-2 p-5">
      <Heading className="text-lg font-semibold leading-snug tracking-tight">
        <Link href={card.href} className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline group-hover:underline underline-offset-4">{card.title}</Link>
      </Heading>
      {card.excerpt && <p className="line-clamp-3 text-sm text-muted-foreground">{card.excerpt}</p>}
      <p className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" /><time dateTime={card.dateTime}>{card.date}</time></span>
        {card.minutes && <span className="inline-flex items-center gap-1.5"><Clock className="size-3.5" aria-hidden="true" />{card.minutes}</span>}
      </p>
    </div>
  </article>;
}
