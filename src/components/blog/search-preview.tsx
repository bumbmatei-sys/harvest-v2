import { searchPreview } from "@/lib/blog";
import type { DocContent } from "@/lib/docs";

/** A small, Harvest-written picture of how a search engine might list the article (title, address, description). Text only; nothing is fetched. */
export function SearchPreview({ label, untitled, ...input }: { label: string; untitled: string; title: string; seoTitle?: string | null; seoDescription?: string | null; excerpt?: string | null; body?: DocContent | null; url: string }) {
  const view = searchPreview(input);
  return <figure className="space-y-1 rounded-lg border bg-card p-4" aria-label={label} data-blog-search-preview>
    <p className="truncate text-xs text-muted-foreground" dir="ltr">{view.url}</p>
    <p className="line-clamp-1 text-lg font-medium text-primary">{view.title || untitled}</p>
    <p className="line-clamp-2 text-sm text-muted-foreground">{view.description}</p>
  </figure>;
}
