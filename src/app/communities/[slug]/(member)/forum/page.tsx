import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Lock, MessageSquare, Pin, PlayCircle } from "lucide-react";
import { getDb } from "@/db/client";
import { listPosts } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { PostComposer } from "@/components/forum/post-composer";
import { LikeButton } from "@/components/forum/like-button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string; sort?: string }> };

// C10: the forum. Categories column, New / Best this week, post cards (Eden design, Studio Admin style).
export default async function ForumPage({ params, searchParams }: Props) {
  const session = await pageSession("personal"), { slug } = await params, query = await searchParams;
  const category = query.category && /^[0-9a-f-]{36}$/.test(query.category) ? query.category : undefined, sort = query.sort === "best" ? "best" : "new";
  const { context, posts } = await listPosts(getDb(), session.user.id, slug, { category, sort });
  const t = await getTranslations("CommunityForum"), format = await getFormatter(), base = `/communities/${context.slug}/forum`;
  const href = (next: { category?: string; sort?: string }) => { const q = new URLSearchParams(); const c = "category" in next ? next.category : category, s = next.sort ?? sort;
    if (c) q.set("category", c); if (s === "best") q.set("sort", "best"); return q.size ? `${base}?${q}` : base; };
  const categoryName = (id: string) => context.categories.find((c) => c.id === id);
  return <div className="grid min-w-0 gap-6 p-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:p-6">
    <nav aria-label={t("categories")} className="min-w-0">
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible">
        {[{ id: undefined, name: t("allPosts"), emoji: null, hostsOnly: false }, ...context.categories].map((c) => <li key={c.id ?? "all"} className="shrink-0">
          <Link href={href({ category: c.id })} aria-current={category === c.id ? "page" : undefined} prefetch={false}
            className={cn("flex min-h-11 items-center gap-2 rounded-md px-3 text-sm whitespace-nowrap", category === c.id ? "bg-muted font-medium" : "hover:bg-muted/60")}>
            {c.emoji && <span aria-hidden="true">{c.emoji}</span>}<span className="flex-1">{c.name}</span>
            {c.hostsOnly && <Lock className="size-3.5 text-muted-foreground" aria-label={t("hostsOnly")} />}</Link></li>)}
      </ul>
    </nav>
    <section className="min-w-0 space-y-4" aria-labelledby="forum-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="forum-title" className="text-xl font-semibold">{category ? categoryName(category)?.name : t("allPosts")}</h2>
        <PostComposer slug={context.slug} categories={context.categories} defaultCategory={category} canModerate={context.canModerate} />
      </div>
      <nav aria-label={t("sort")} className="flex gap-2">
        {(["new", "best"] as const).map((s) => <Link key={s} href={href({ sort: s })} aria-current={sort === s ? "page" : undefined} prefetch={false}
          className={cn("inline-flex min-h-11 items-center rounded-md px-3 text-sm", sort === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}>{t(`sorts.${s}`)}</Link>)}
      </nav>
      {posts.length === 0 ? <Empty className="border"><EmptyHeader><EmptyTitle>{t("empty")}</EmptyTitle></EmptyHeader></Empty>
        : <ul className="space-y-3">{posts.map((post) => { const cat = categoryName(post.categoryId); return <li key={post.id}>
          <article className="flex gap-4 rounded-lg border p-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
            {post.coverFileId && <img src={`/api/communities/${context.slug}/files/${post.coverFileId}`} alt="" className="hidden size-24 shrink-0 rounded-md object-cover sm:block" />}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {post.pinned && <Badge variant="secondary"><Pin className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
                {cat && <Badge variant="outline">{cat.emoji ? `${cat.emoji} ` : ""}{cat.name}</Badge>}
                {post.hasVideo && <PlayCircle className="size-4" aria-label={t("hasVideo")} />}
              </div>
              <h3 className="text-base font-semibold break-words"><Link href={`/communities/${context.slug}/posts/${post.id}`} prefetch={false} className="hover:underline">{post.title}</Link></h3>
              {post.excerpt && <p className="line-clamp-2 text-sm text-muted-foreground break-words">{post.excerpt}</p>}
              <div className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
                <span>{post.authorName?.trim() || t("unnamed")}</span><span>{format.dateTime(post.createdAt, { dateStyle: "medium" })}</span>
                <span className="inline-flex items-center gap-1"><MessageSquare className="size-4" aria-hidden="true" />{t("replies", { count: post.comments })}</span>
                <LikeButton slug={context.slug} targetType="post" targetId={post.id} likes={post.likes} liked={post.liked} disabled={post.likesOff} label={post.title} />
              </div>
            </div>
          </article></li>; })}</ul>}
    </section>
  </div>;
}
