/** Derived from Shadcn UI Kit item social-media-post2 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PinIcon, PlayCircleIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { PostEngagement } from "@/components/forum/forum-actions";
import { memberInitials } from "@/lib/community-members";

export type PostCardData = { id: string; title: string; excerpt: string; authorId: string | null; authorName: string | null; createdAt: Date; likes: number; comments: number;
  liked: boolean; likesOff: boolean; coverFileId: string | null; hasVideo: boolean; held: boolean; pinned: boolean };

type Translate = (key: "formerMember" | "unnamed") => string;
/** The name shown for an author: their name, "Member" without one, "Former member" once the account is gone (author id cleared). */
export function forumAuthorName(t: Translate, authorId: string | null, authorName: string | null) {
  return authorId ? authorName?.trim() || t("unnamed") : t("formerMember");
}

/**
 * A forum post in the feed as the kit's social post card: author header with the actions menu, title and excerpt, the cover, and the
 * like and reply counts in the footer. Who may see or act on the post is decided by the server before this renders. `detail` and
 * `footer` still render the full post for callers that use the card on its own page (the post page uses PostThread).
 */
export function PostCard({ slug, post, category, menu, meta, detail, footer, children }: { slug: string; post: PostCardData; category?: { name: string; emoji: string | null };
  /** The "..." menu (forum-actions PostMenu). */ menu?: ReactNode;
  /** Extra items after the date, such as the hosts' edit history. */ meta?: ReactNode;
  /** The full post on its own page: body, video and attachments, whether liking is paused (held post, muted member) and the reply box id. */
  detail?: { body: ReactNode; likeDisabled: boolean; replyTarget?: string };
  footer?: ReactNode; children?: ReactNode }) {
  const t = useTranslations("CommunityForum"), format = useFormatter(), href = `/communities/${slug}/posts/${post.id}`;
  const author = forumAuthorName(t, post.authorId, post.authorName), Title = detail ? "h2" : "h3";
  return (
    <article aria-label={post.title} className="relative w-full min-w-0">
      <Card className="relative w-full overflow-hidden shadow-none">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar>
              <AvatarFallback aria-hidden="true">{memberInitials(post.authorId ? post.authorName ?? "" : "")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-semibold">{author}</span>
              </div>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                <span>{format.dateTime(post.createdAt, { dateStyle: "medium" })}</span>
                {category && <><span aria-hidden="true">{t("dot")}</span><span>{category.emoji ? `${category.emoji} ` : ""}{category.name}</span></>}
                {!detail && post.hasVideo && <PlayCircleIcon className="size-3.5" aria-label={t("hasVideo")} />}
                {post.pinned && <Badge variant="secondary" className="px-1.5 py-0"><PinIcon className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
                {post.held && <Badge variant="outline" className="px-1.5 py-0">{t("awaitingReview")}</Badge>}
                {meta}
              </p>
            </div>
          </div>
          {menu}
        </CardHeader>

        <CardContent className="min-w-0 space-y-4">
          <div className="space-y-2">
            <Title className={detail ? "text-xl font-semibold break-words" : "font-semibold break-words"}>
              {detail ? post.title : <Link href={href} prefetch={false} className="hover:underline">{post.title}</Link>}
            </Title>
            {detail ? <div className="space-y-3">{detail.body}</div> : post.excerpt && (
              <p className="line-clamp-3 text-sm leading-relaxed break-words">{post.excerpt}</p>
            )}
          </div>

          {post.coverFileId && (
            <div className="relative aspect-video overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
              <img
                src={`/api/communities/${slug}/files/${post.coverFileId}`}
                alt=""
                className="size-full object-cover"
              />
            </div>
          )}
          {children}
        </CardContent>

        <CardFooter className="flex items-center justify-between">
          <PostEngagement slug={slug} postId={post.id} title={post.title} likes={post.likes} liked={post.liked} likesOff={post.likesOff} className="-ms-3 gap-1"
            likeDisabled={detail?.likeDisabled ?? false} replies={post.comments} repliesHref={detail ? undefined : href} replyTarget={detail?.replyTarget} />
        </CardFooter>
        {footer && <CardFooter className="gap-2 border-t">
          {footer}
        </CardFooter>}
      </Card>
    </article>
  );
}
