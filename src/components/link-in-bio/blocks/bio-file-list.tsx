/** Derived from Shadcn UI Kit item list-block13 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Link in bio rework). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import { useTranslations } from "next-intl";
import { ExternalLink, FileText } from "lucide-react";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { BioCatalogCard } from "@/lib/link-in-bio";

/**
 * PDFs and ebooks: the ministry's download products as file rows (icon tile, title, one line of summary, a View button). The files themselves stay behind
 * the product's own page, which asks the visitor to sign in before it lists them; nothing here hands out a file.
 */
export function BioFileList({ title, items, onOpen, inert }: { title: string; items: BioCatalogCard[]; onOpen?: (event: React.MouseEvent) => void; inert?: { tabIndex?: number } }) {
  const t = useTranslations("LinkInBio.public");
  return <section className="rounded-xl border bg-card px-4 py-2 text-card-foreground" aria-label={title || t("filesLabel")} data-bio-files>
    {title && <h2 className="pt-2 pb-1 text-base font-semibold">{title}</h2>}
    {items.map((item) => <Item key={item.id} size="sm" className="rounded-none border-x-0 border-t-0 border-b-border px-0 last:border-b-0">
      <ItemMedia className="size-10 rounded-md border bg-muted text-muted-foreground"><FileText className="size-5" aria-hidden="true" /></ItemMedia>
      <ItemContent className="min-w-0"><ItemTitle className="break-words">{item.title}</ItemTitle>
        {item.summary && <ItemDescription className="line-clamp-1 text-xs">{item.summary}</ItemDescription>}</ItemContent>
      <ItemActions>
        <a href={`/products/${item.slug}`} {...inert} onClick={onOpen} aria-label={t("viewFile", { title: item.title })}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <ExternalLink className="size-4" aria-hidden="true" />{t("view")}</a>
      </ItemActions>
    </Item>)}
  </section>;
}
