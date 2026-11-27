/** Derived from Shadcn UI Kit item social-media-post1 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 7). Visual reference only; local changes: docs/ui-sources.md. */
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { EyeOff, MessageSquare, Pin, PlayCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { LikeButton } from "@/components/forum/like-button";
import { memberInitials } from "@/lib/community-members";

export type PostCardData = { id: string; title: string; excerpt: string; authorName: string | null; createdAt: Date; likes: number; comments: number; liked: boolean; likesOff: boolean;
  coverFileId: string | null; hasVideo: boolean; held: boolean; pinned: boolean; harvestHidden?: boolean };

/**
 * A forum post in the feed: author and date, optional cover, title, excerpt and a footer with replies and likes. Presentation only; the like
 * request, hosts-only categories, held posts and who may see the post are decided by the server before this renders.
 */
export function PostCard({ slug, post, category }: { slug: string; post: PostCardData; category?: { name: string; emoji: string | null } }) {
  const t = useTranslations("CommunityForum"), th = useTranslations("CommunityTakedown"), format = useFormatter(), author = post.authorName?.trim() || t("unnamed"), href = `/communities/${slug}/posts/${post.id}`;
  return <article aria-label={post.title}><Card className="gap-0 overflow-hidden py-0 shadow-none">
    <CardHeader className="flex flex-row flex-wrap items-center gap-3 py-3">
      <Avatar><AvatarFallback aria-hidden="true">{memberInitials(post.authorName ?? "")}</AvatarFallback></Avatar>
      <div className="min-w-0 flex-1 leading-tight"><p className="truncate text-sm font-medium">{author}</p><p className="text-xs text-muted-foreground">{format.dateTime(post.createdAt, { dateStyle: "medium" })}</p></div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {post.pinned && <Badge variant="secondary"><Pin className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
        {post.held && <Badge variant="outline">{t("awaitingReview")}</Badge>}
        {post.harvestHidden && <Badge variant="destructive" data-harvest-hidden><EyeOff className="size-3" aria-hidden="true" />{th("hiddenByHarvest")}</Badge>}
        {category && <Badge variant="outline">{category.emoji ? `${category.emoji} ` : ""}{category.name}</Badge>}
        {post.hasVideo && <PlayCircle className="size-4" aria-label={t("hasVideo")} />}
      </div>
    </CardHeader>
    <CardContent className="p-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
      {post.coverFileId && <img src={`/api/communities/${slug}/files/${post.coverFileId}`} alt="" className="aspect-video w-full border-y object-cover" />}
      <div className="min-w-0 space-y-2 px-6 py-4">
        <h3 className="text-base font-semibold break-words"><Link href={href} prefetch={false} className="hover:underline">{post.title}</Link></h3>
        {post.excerpt && <p className="line-clamp-3 text-sm text-muted-foreground break-words">{post.excerpt}</p>}
      </div>
    </CardContent>
    <CardFooter className="flex flex-wrap items-center gap-1 border-t px-3 py-1">
      <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
        <MessageSquare className="size-4" aria-hidden="true" />{t("replies", { count: post.comments })}</Link>
      <LikeButton slug={slug} targetType="post" targetId={post.id} likes={post.likes} liked={post.liked} disabled={post.likesOff} label={post.title} />
    </CardFooter>
  </Card></article>;
}
