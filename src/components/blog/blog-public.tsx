/** Blog index header layout reference: Shadcn UI Kit item changelog2 (premium, founder-approved 27 Nov 2026), used as a layout reference only; Harvest code, theme tokens and catalogue copy. Notes: docs/ui-sources.md. */
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight, Newspaper, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { BlogArticleCard } from "@/components/blog/blog-card";
import { blogPath, type BlogCard, type BlogIndexView } from "@/lib/blog";
import { blogImagePath } from "@/server/blog-public";

/** The cards of a list, with the picture through the blog's public picture address. */
export async function BlogCards({ handle, cards, headingLevel = 2 }: { handle: string; cards: BlogCard[]; headingLevel?: 2 | 3 }) {
  const t = await getTranslations("Blog.public"), format = await getFormatter();
  return <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3" data-blog-cards>{cards.map((card) => <li key={card.slug} className="flex">
    <BlogArticleCard className="w-full" headingLevel={headingLevel} card={{ href: blogPath(handle, card.slug), title: card.title, excerpt: card.excerpt, date: format.dateTime(new Date(card.publishedAt), { dateStyle: "medium" }),
      dateTime: card.publishedAt, minutes: card.readingMinutes ? t("minutes", { count: card.readingMinutes }) : undefined, coverUrl: card.coverId ? blogImagePath(handle, card.coverId) : null }} />
  </li>)}</ul>;
}

/** The public index: title, intro and the feed link, then the cards and page links, or the empty state. */
export async function BlogIndex({ view }: { view: BlogIndexView }) {
  const t = await getTranslations("Blog.public");
  const page = (n: number) => n === 1 ? blogPath(view.handle) : `${blogPath(view.handle)}?page=${n}`;
  return <div className="space-y-10" data-blog-index>
    <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-8">
      <div className="min-w-0 max-w-3xl space-y-3"><h1 className="text-balance text-4xl font-semibold tracking-tight">{view.title}</h1>
        {view.intro && <p className="text-pretty text-lg text-muted-foreground">{view.intro}</p>}</div>
      <Button asChild variant="outline" size="icon" className="size-11 shrink-0"><a href={`${blogPath(view.handle)}/rss.xml`} aria-label={t("rss")} title={t("rss")} type="application/rss+xml"><Rss aria-hidden="true" /></a></Button>
    </header>
    {view.posts.length === 0 ? <EmptyState icon={Newspaper} title={t("emptyTitle")} description={t("emptyBody")} headingLevel={2} solid />
      : <BlogCards handle={view.handle} cards={view.posts} />}
    {view.pages > 1 && <nav aria-label={t("pagination")} className="flex flex-wrap items-center justify-between gap-3">
      {view.page > 1 ? <Button asChild variant="outline" className="min-h-11"><Link href={page(view.page - 1)} rel="prev"><ChevronLeft aria-hidden="true" />{t("previous")}</Link></Button> : <span />}
      <p className="text-sm text-muted-foreground" aria-current="page">{t("pageOf", { page: view.page, pages: view.pages })}</p>
      {view.page < view.pages ? <Button asChild variant="outline" className="min-h-11"><Link href={page(view.page + 1)} rel="next">{t("next")}<ChevronRight aria-hidden="true" /></Link></Button> : <span />}
    </nav>}
  </div>;
}
