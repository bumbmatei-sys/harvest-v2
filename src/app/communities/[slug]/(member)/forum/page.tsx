/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/page.tsx; code written for Harvest, no kit code copied. Left column and centred feed of post cards; the stories row and right-hand suggestions are not used. */
import { notFound } from "next/navigation";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { MessageSquare } from "lucide-react";
import { getDb } from "@/db/client";
import { listPosts } from "@/server/community-forum";
import { myWarnings } from "@/server/community-moderation";
import { WarningAlerts } from "@/components/communities/warning-alerts";
import { WelcomeCard } from "@/components/communities/welcome-card";
import { pageSession } from "@/server/page-session";
import { communitiesEnabled } from "@/server/communities-mode";
import { orPublicPage } from "@/server/community-member-page";
import { PostComposer } from "@/components/forum/post-composer";
import { PostCard } from "@/components/forum/post-card";
import { PostMenu } from "@/components/forum/forum-actions";
import { ForumSidebar } from "@/components/forum/forum-sidebar";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string; sort?: string; page?: string; new?: string }> };

// C10: the forum. Categories column, New / Best this week, post cards (Eden design, Studio Admin style).
export default async function ForumPage({ params, searchParams }: Props) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug } = await params, query = await searchParams;
  const page = Math.min(1000, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const category = query.category && /^[0-9a-f-]{36}$/.test(query.category) ? query.category : undefined, sort = query.sort === "best" ? "best" : "new";
  const { context, posts, hasMore } = await listPosts(getDb(), session.user.id, slug, { category, sort, page }).catch(orPublicPage(slug));
  const t = await getTranslations("CommunityForum"), format = await getFormatter(), base = `/communities/${context.slug}/forum`;
  const warnings = await myWarnings(getDb(), session.user.id, slug);
  // C15a: "Introduce yourself" opens the composer on the introductions category.
  const composeIn = context.categories.find((c) => c.id === query.new && (context.canModerate || !c.hostsOnly))?.id;
  const href = (next: { category?: string; sort?: string; page?: number }) => { const q = new URLSearchParams(); const c = "category" in next ? next.category : category, s = next.sort ?? sort;
    if (c) q.set("category", c); if (s === "best") q.set("sort", "best"); if (next.page && next.page > 1) q.set("page", String(next.page)); return q.size ? `${base}?${q}` : base; };
  const categoryName = (id: string) => context.categories.find((c) => c.id === id);
  const me = session.user.name?.trim() || t("unnamed");
  return <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6 lg:p-6">
    <ForumSidebar navItems={[{ id: undefined, name: t("allPosts"), emoji: null, hostsOnly: false }, ...context.categories].map((c) => ({ id: c.id, label: c.name, emoji: c.emoji,
      hostsOnly: c.hostsOnly, href: href({ category: c.id }), active: category === c.id }))}
      composer={!context.mutedUntil && <PostComposer key={composeIn ?? "new"} slug={context.slug} categories={context.categories} defaultCategory={composeIn ?? category}
        canModerate={context.canModerate} author={me} defaultOpen={Boolean(composeIn)} />} />
    <section className="mx-auto w-full min-w-0 space-y-4 lg:max-w-2xl lg:space-y-6" aria-labelledby="forum-title">
      <WarningAlerts slug={context.slug} warnings={warnings} />
      {!context.welcome.dismissed && <WelcomeCard slug={context.slug} message={context.welcome.message} introCategoryId={context.welcome.introCategoryId} prefs={context.prefs} hasRules={context.rulesList.length > 0} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="forum-title" className="text-xl font-semibold">{category ? categoryName(category)?.name : t("allPosts")}</h2>
        <nav aria-label={t("sort")} className="flex gap-2">
          {(["new", "best"] as const).map((s) => <Link key={s} href={href({ sort: s })} aria-current={sort === s ? "page" : undefined} prefetch={false}
            className={cn("inline-flex min-h-11 items-center rounded-md px-3 text-sm", sort === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>{t(`sorts.${s}`)}</Link>)}
        </nav>
      </div>
      {context.mutedUntil && <Alert><AlertDescription>{t("mutedUntil", { date: format.dateTime(context.mutedUntil, { dateStyle: "medium", timeStyle: "short" }) })}</AlertDescription></Alert>}
      {posts.length === 0 ? <EmptyState icon={MessageSquare} title={t("empty")} />
        : <ul className="space-y-4 lg:space-y-6">{posts.map((post) => <li key={post.id}><PostCard slug={context.slug} post={post} category={categoryName(post.categoryId)}
          menu={<PostMenu slug={context.slug} post={{ id: post.id, title: post.title, pinned: post.pinned, held: post.held }} isAuthor={post.authorId === session.user.id} canModerate={context.canModerate} />} /></li>)}</ul>}
      {(page > 1 || hasMore) && <nav aria-label={t("pages")} className="flex justify-between gap-2 pt-2">
        {page > 1 ? <Button variant="outline" className="min-h-11" asChild><Link href={href({ page: page - 1 })} prefetch={false}>{t("newer")}</Link></Button> : <span />}
        {hasMore && <Button variant="outline" className="min-h-11" asChild><Link href={href({ page: page + 1 })} prefetch={false}>{t("older")}</Link></Button>}
      </nav>}
    </section>
  </div>;
}
