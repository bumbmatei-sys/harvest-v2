/** Derived from Shadcn UI Kit item social-media-post3 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
import Link from "next/link";
import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { PinIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PostEngagement } from "@/components/forum/forum-actions";
import { forumAuthorName, type PostCardData } from "@/components/forum/post-card";
import { memberInitials } from "@/lib/community-members";

/**
 * A post on its own page as the kit's post with comments: author header with the category and the actions menu, the full post and
 * cover, the like count, the like and reply actions between separators, the reply box, then the replies in the footer. Same props as
 * PostCard; who may see or act on the post is decided by the server before this renders.
 */
export function PostThread({ slug, post, category, menu, meta, detail, footer, children }: { slug: string; post: PostCardData; category?: { id?: string; name: string; emoji: string | null };
  /** The "..." menu (forum-actions PostMenu). */ menu?: ReactNode;
  /** Extra items after the date, such as the hosts' edit history. */ meta?: ReactNode;
  /** The body, video and attachments, whether liking is paused (held post, muted member) and the reply box id. */
  detail: { body: ReactNode; likeDisabled: boolean; replyTarget?: string };
  /** The reply box, or why replying is closed. */ footer?: ReactNode;
  /** The replies (PostComments). */ children?: ReactNode }) {
  const t = useTranslations("CommunityForum"), format = useFormatter();
  const author = forumAuthorName(t, post.authorId, post.authorName);
  return (
    <article aria-label={post.title} className="min-w-0">
      <Card className="w-full shadow-none">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <Avatar className="size-10">
              <AvatarFallback aria-hidden="true">{memberInitials(post.authorId ? post.authorName ?? "" : "")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-1 text-sm">
                <span className="font-semibold">{author}</span>
                {category && <>
                  <span className="text-muted-foreground">{t("inCategory")}</span>
                  {category.id ? <Link href={`/communities/${slug}/forum?category=${category.id}`} prefetch={false} className="text-primary hover:underline">
                    {category.emoji ? `${category.emoji} ` : ""}{category.name}
                  </Link> : <span>{category.emoji ? `${category.emoji} ` : ""}{category.name}</span>}
                </>}
              </div>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                <span>{format.dateTime(post.createdAt, { dateStyle: "full", timeStyle: "short" })}</span>
                {post.pinned && <Badge variant="secondary" className="px-1.5 py-0"><PinIcon className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
                {post.held && <Badge variant="outline" className="px-1.5 py-0">{t("awaitingReview")}</Badge>}
                {meta}
              </p>
            </div>
          </div>
          {menu}
        </CardHeader>

        <CardContent className="min-w-0 space-y-4">
          <h2 className="text-xl font-semibold break-words">{post.title}</h2>
          <div className="space-y-3">{detail.body}</div>

          {post.coverFileId && <div className="grid grid-cols-2 gap-2">
            <div
              className="relative col-span-2 aspect-4/3 overflow-hidden rounded-lg"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
              <img
                src={`/api/communities/${slug}/files/${post.coverFileId}`}
                alt=""
                className="size-full object-cover"
              />
            </div>
          </div>}

          {!post.likesOff && <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground text-xs">
                {t("likeCount", { count: post.likes })}
              </span>
            </div>
          </div>}

          <Separator />

          <PostEngagement slug={slug} postId={post.id} title={post.title} likes={post.likes} liked={post.liked} likesOff={post.likesOff} className="justify-around"
            likeDisabled={detail.likeDisabled} replies={post.comments} replyTarget={detail.replyTarget} />

          {footer && <>
            <Separator />

            <div className="flex items-center gap-2">
              {footer}
            </div>
          </>}
        </CardContent>

        <CardFooter className="flex-col items-start gap-4">
          {children}
        </CardFooter>
      </Card>
    </article>
  );
}

/** The replies under the post, as the kit's comment list. */
export function PostComments({ count, children }: { count: number; children: ReactNode }) {
  const t = useTranslations("CommunityForum");
  return <section aria-labelledby="post-replies" className="w-full space-y-4">
    <h3 id="post-replies" className="text-muted-foreground text-xs font-medium">{t("replies", { count })}</h3>
    {count > 0 && <ul className="flex w-full flex-col gap-4">{children}</ul>}
  </section>;
}

/** One reply: avatar, name and date, its like on the right, the text, then its badges and actions. */
export function PostComment({ authorId, authorName, body, createdAt, like, badges, actions }: { authorId: string | null; authorName: string | null; body: string; createdAt: Date;
  like?: ReactNode; badges?: ReactNode; actions?: ReactNode }) {
  const t = useTranslations("CommunityForum"), format = useFormatter(), name = forumAuthorName(t, authorId, authorName);
  return (
    <li className="flex w-full gap-3">
      <Avatar>
        <AvatarFallback aria-hidden="true">{memberInitials(authorId ? authorName ?? "" : "")}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold">{name}</p>
            <p className="text-muted-foreground text-xs">
              {format.dateTime(createdAt, { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {like}
          </div>
        </div>
        <p className="text-sm leading-relaxed break-words whitespace-pre-line">{body}</p>
        {(badges || actions) && <div className="-ms-2 flex flex-wrap items-center gap-x-1">
          {badges}
          {actions}
        </div>}
      </div>
    </li>
  );
}
