/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/page.tsx; code written for Harvest, no kit code copied. Centred feed of post cards (max-w-2xl) on a sunken page surface; categories as chips above the feed and the composer card at the top in place of the kit left column; the stories row and right-hand suggestions are not used. */
import { communityPostLink } from "@/lib/site-address";
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
import { CategoryPills } from "@/components/forum/category-pills";
import { ForumPager } from "@/components/forum/forum-pager";
import { PostMenu } from "@/components/forum/forum-actions";
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
  const canPost = !context.mutedUntil && context.categories.some((c) => context.canModerate || !c.hostsOnly);
  const chips = [{ id: undefined, name: t("allPosts"), emoji: null, hostsOnly: false }, ...context.categories];
  return <div data-surface="sunken" className="min-w-0 p-4 lg:p-6">
    <section className="mx-auto w-full min-w-0 space-y-4 lg:max-w-2xl" aria-labelledby="forum-title">
      <h2 id="forum-title" className="sr-only">{category ? categoryName(category)?.name : t("allPosts")}</h2>
      <WarningAlerts slug={context.slug} warnings={warnings} />
      {!context.welcome.dismissed && <WelcomeCard slug={context.slug} message={context.welcome.message} introCategoryId={context.welcome.introCategoryId} prefs={context.prefs} hasRules={context.rulesList.length > 0} />}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <CategoryPills label={t("categories")} hostsOnlyLabel={t("hostsOnly")} categories={chips.map((c) => ({ key: c.id ?? "all", label: c.name, emoji: c.emoji, hostsOnly: c.hostsOnly, href: href({ category: c.id }), active: category === c.id }))} />
        </div>
        <nav aria-label={t("sort")} className="flex shrink-0 gap-1 self-start rounded-full border bg-card p-1 sm:self-auto">
          {(["new", "best"] as const).map((s) => <Link key={s} href={href({ sort: s })} aria-current={sort === s ? "page" : undefined} prefetch={false}
            className={cn("inline-flex min-h-11 items-center rounded-full px-3 text-sm whitespace-nowrap lg:min-h-8", sort === s ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60")}>{t(`sorts.${s}`)}</Link>)}
        </nav>
      </div>
      {canPost && <PostComposer key={composeIn ?? "new"} slug={context.slug} categories={context.categories} defaultCategory={composeIn ?? category}
        canModerate={context.canModerate} author={me} defaultOpen={Boolean(composeIn)} />}
      {context.mutedUntil && <Alert><AlertDescription>{t("mutedUntil", { date: format.dateTime(context.mutedUntil, { dateStyle: "medium", timeStyle: "short" }) })}</AlertDescription></Alert>}
      {posts.length === 0 ? <EmptyState icon={MessageSquare} title={t("empty")} />
        : <ul className="space-y-4">{posts.map((post) => <li key={post.id}><PostCard slug={context.slug} post={post} category={categoryName(post.categoryId)}
          menu={<PostMenu slug={context.slug} copyHref={communityPostLink(context.slug, post.id)} post={{ id: post.id, title: post.title, pinned: post.pinned, held: post.held }} isAuthor={post.authorId === session.user.id} canModerate={context.canModerate} />} /></li>)}</ul>}
      {(page > 1 || hasMore) && <div className="pt-2"><ForumPager label={t("pages")} newer={{ label: t("newer"), href: page > 1 ? href({ page: page - 1 }) : null }}
        older={{ label: t("older"), href: hasMore ? href({ page: page + 1 }) : null }} /></div>}
    </section>
  </div>;
}
