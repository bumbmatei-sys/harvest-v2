/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/post-item.tsx. Harvest changes: the kit's sample post and local state become the real forum post (title, cover, excerpt or full body, replies); like, reply, report, pin, edit and remove call the existing forum routes from forum-actions.tsx; share, save, hide and unfollow are dropped (Harvest has none); no remote avatars or liker faces; catalogue strings and semantic tokens. Notes: docs/ui-sources.md. */
import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Pin, PlayCircle } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { PostEngagement } from "@/components/forum/forum-actions";
import { memberInitials } from "@/lib/community-members";

export type PostCardData = { id: string; title: string; excerpt: string; authorId?: string | null; authorName: string | null; createdAt: Date; likes: number; comments: number;
  liked: boolean; likesOff: boolean; coverFileId: string | null; hasVideo: boolean; held: boolean; pinned: boolean };

type Translate = (key: "formerMember" | "unnamed") => string;
/** The name shown for an author: their name, "Member" without one, "Former member" once the account is gone (author id cleared). */
export function forumAuthorName(t: Translate, authorId: string | null | undefined, authorName: string | null) {
  return authorId === null ? t("formerMember") : authorName?.trim() || t("unnamed");
}

/**
 * A forum post as the kit's social post card: author header with the actions menu, cover, title, excerpt (feed) or the full post (detail),
 * the like and reply actions with the like count, and on the detail page the replies and the reply box. Who may see or act on the post is
 * decided by the server before this renders.
 */
export function PostCard({ slug, post, category, menu, meta, detail, footer, children }: { slug: string; post: PostCardData; category?: { name: string; emoji: string | null };
  /** The "..." menu (forum-actions PostMenu). */ menu?: ReactNode;
  /** Extra items after the date, such as the hosts' edit history. */ meta?: ReactNode;
  /** The full post on its own page: body, video and attachments, whether liking is paused (held post, muted member) and the reply box id. */
  detail?: { body: ReactNode; likeDisabled: boolean; replyTarget?: string };
  footer?: ReactNode; children?: ReactNode }) {
  const t = useTranslations("CommunityForum"), format = useFormatter(), href = `/communities/${slug}/posts/${post.id}`;
  const author = forumAuthorName(t, post.authorId, post.authorName), Title = detail ? "h2" : "h3";
  return <article aria-label={post.title} className="min-w-0">
    <Card className={footer ? "gap-3 py-4 shadow-sm" : "gap-3 pt-4 pb-2 shadow-sm"}>
      <CardHeader className="px-4">
        {/* Post Header */}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarFallback aria-hidden="true">{memberInitials(post.authorId === null ? "" : post.authorName ?? "")}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span className="truncate text-sm font-semibold">{author}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground text-xs">
              <span>{format.dateTime(post.createdAt, { dateStyle: "medium" })}</span>
              {category && <><span aria-hidden="true">{t("dot")}</span><span>{category.emoji ? `${category.emoji} ` : ""}{category.name}</span></>}
              {!detail && post.hasVideo && <PlayCircle className="size-3.5" aria-label={t("hasVideo")} />}
              {post.pinned && <Badge variant="secondary" className="px-1.5 py-0"><Pin className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
              {post.held && <Badge variant="outline" className="px-1.5 py-0">{t("awaitingReview")}</Badge>}
              {meta}
            </div>
          </div>
        </div>
        {menu && <CardAction>
          {menu}
        </CardAction>}
      </CardHeader>

      <CardContent className="min-w-0 space-y-2 px-4">
        {/* Post Content */}
        <Title className={detail ? "text-xl font-semibold break-words" : "text-base font-semibold break-words"}>
          {detail ? post.title : <Link href={href} prefetch={false} className="hover:underline">{post.title}</Link>}
        </Title>
        {detail ? <div className="space-y-3">{detail.body}</div> : post.excerpt && (
          <p className="line-clamp-3 text-sm break-words">{post.excerpt}</p>
        )}
        {post.coverFileId && (
          <div className="ring-foreground/5 overflow-hidden rounded-lg ring-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
            <img src={`/api/communities/${slug}/files/${post.coverFileId}`} alt="" className="aspect-video w-full object-cover" />
          </div>
        )}

        {/* Post Actions */}
        <PostEngagement slug={slug} postId={post.id} title={post.title} likes={post.likes} liked={post.liked} likesOff={post.likesOff}
          likeDisabled={detail?.likeDisabled ?? false} replies={post.comments} repliesHref={detail ? undefined : href} replyTarget={detail?.replyTarget} />

        {children}
      </CardContent>

      {/* Add Comment */}
      {footer && <CardFooter className="gap-2 border-t px-4 pt-3 [.border-t]:pt-3">
        {footer}
      </CardFooter>}
    </Card>
  </article>;
}

/** The replies under the expanded card, as the kit's comments section. */
export function PostComments({ count, children }: { count: number; children: ReactNode }) {
  const t = useTranslations("CommunityForum");
  return <section aria-labelledby="post-replies" className="space-y-3 border-t pt-2">
    <h3 id="post-replies" className="text-muted-foreground text-xs font-medium">{t("replies", { count })}</h3>
    {count > 0 && <ul className="space-y-3">{children}</ul>}
  </section>;
}

/** One reply: avatar, name and text, its like on the right, then the date and the reply's own actions. */
export function PostComment({ authorId, authorName, body, createdAt, like, badges, actions }: { authorId: string | null; authorName: string | null; body: string; createdAt: Date;
  like?: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  const t = useTranslations("CommunityForum"), format = useFormatter(), name = forumAuthorName(t, authorId, authorName);
  return <li className="flex gap-2">
    <Avatar className="h-8 w-8">
      <AvatarFallback aria-hidden="true">{memberInitials(authorId === null ? "" : authorName ?? "")}</AvatarFallback>
    </Avatar>
    <div className="min-w-0 flex-1">
      <div className="w-fit max-w-full rounded-2xl bg-muted px-3 py-2">
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-sm break-words whitespace-pre-line">{body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-1 px-1">
        <span className="text-muted-foreground px-1 text-xs">{format.dateTime(createdAt, { dateStyle: "medium" })}</span>
        {like}
        {badges}
        {actions}
      </div>
    </div>
  </li>;
}
