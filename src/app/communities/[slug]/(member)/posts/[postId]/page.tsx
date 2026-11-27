import { communityPostLink } from "@/lib/site-address";
/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/post-item.tsx; code written for Harvest, no kit code copied. The post page is the feed card expanded: full post, the replies below and the reply box in the card footer. */
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, FileText } from "lucide-react";
import { getDb } from "@/db/client";
import { getPost } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { communitiesEnabled } from "@/server/communities-mode";
import { AccessError } from "@/server/permissions";
import { notFound } from "next/navigation";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { VideoEmbedView } from "@/components/forum/video-embed";
import { LikeButton } from "@/components/forum/like-button";
import { CommentActions, PostMenu, ReplyForm } from "@/components/forum/forum-actions";
import { PostCard, PostComment, PostComments, forumAuthorName } from "@/components/forum/post-card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReportDialog } from "@/components/communities/report-dialog";
import { EditHistory } from "@/components/communities/edit-history";

// A missing or removed post is not found; a non-member never gets here (the member layout redirects).
const missingPost = (error: unknown): never => { if (error instanceof AccessError && error.status === 404) notFound(); throw error; };

export default async function PostPage({ params }: { params: Promise<{ slug: string; postId: string }> }) {
  if (!communitiesEnabled()) notFound();
  const session = await pageSession("personal"), { slug, postId } = await params, me = session.user.id;
  const { context, post, attachments, comments } = await getPost(getDb(), me, slug, postId).catch(missingPost);
  const t = await getTranslations("CommunityForum"), format = await getFormatter(), files = `/api/communities/${context.slug}/files`;
  const isAuthor = post.authorId === me, muted = context.mutedUntil, myName = session.user.name?.trim() || t("unnamed");
  const category = context.categories.find((c) => c.id === post.categoryId);
  const canReply = !post.held && !post.commentsOff && !muted;
  const body = <>
    {post.video && <VideoEmbedView video={post.video} title={post.title} />}
    <RichTextView doc={post.body} />
    {attachments.length > 0 && <section aria-labelledby="post-attachments" className="space-y-2">
      <h3 id="post-attachments" className="text-sm font-medium">{t("attachments")}</h3>
      <ul className="space-y-2">{attachments.map((a) => <li key={a.id}><a href={`${files}/${a.id}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm hover:bg-muted">
        <FileText className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{a.name}</span></a></li>)}</ul></section>}
  </>;
  const footer = post.held ? null : post.commentsOff ? <p className="text-sm text-muted-foreground">{t("commentsClosed")}</p>
    : muted ? <Alert><AlertDescription>{t("mutedUntil", { date: format.dateTime(muted, { dateStyle: "medium", timeStyle: "short" }) })}</AlertDescription></Alert>
    : <ReplyForm slug={context.slug} postId={post.id} me={myName} />;
  return <div data-surface="sunken" className="min-w-0 p-4 lg:p-6"><div className="mx-auto w-full min-w-0 space-y-3 lg:max-w-2xl">
    <Link href={`/communities/${context.slug}/forum`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 text-sm text-foreground/80 hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />{t("backToForum")}</Link>
    <PostCard slug={context.slug} category={category} footer={footer}
      post={{ ...post, excerpt: "", comments: comments.length, hasVideo: Boolean(post.video) }}
      detail={{ body, likeDisabled: post.held || Boolean(muted), replyTarget: canReply ? "reply-body" : undefined }}
      meta={post.editedAt && <>
        <span className="text-muted-foreground text-xs">{t("edited")}</span>
        {context.canModerate && <EditHistory slug={context.slug} targetType="post" targetId={post.id} name={post.title} compact />}
      </>}
      menu={<PostMenu slug={context.slug} copyHref={communityPostLink(context.slug, post.id)} post={{ id: post.id, title: post.title, pinned: post.pinned, held: post.held }} isAuthor={isAuthor} canModerate={context.canModerate} detail
        edit={isAuthor && !muted ? { categories: context.categories, author: myName, initial: { id: post.id, categoryId: post.categoryId, title: post.title, body: post.body, videoUrl: post.videoUrl,
          cover: post.coverFileId ? { id: post.coverFileId, name: t("currentCover") } : null, attachments: attachments.map((a) => ({ id: a.id, name: a.name })),
          commentsOff: post.commentsOff, likesOff: post.likesOff } } : undefined} />}>
      <PostComments count={comments.length}>
        {comments.map((c) => { const name = forumAuthorName(t, c.authorId, c.authorName); return <PostComment key={c.id} authorId={c.authorId} authorName={c.authorName} body={c.body} createdAt={c.createdAt}
          like={<LikeButton className="text-muted-foreground h-auto min-h-11 px-2 text-xs lg:min-h-8" slug={context.slug} targetType="comment" targetId={c.id} likes={c.likes} liked={c.liked} disabled={post.likesOff || c.held || Boolean(muted)} label={name} />}
          badges={c.held && <Badge variant="outline">{t("awaitingReview")}</Badge>}
          actions={<>
            <CommentActions slug={context.slug} commentId={c.id} isAuthor={c.authorId === me} canModerate={context.canModerate} name={name} />
            {context.canModerate && c.edits > 0 && <EditHistory slug={context.slug} targetType="comment" targetId={c.id} name={name} compact />}
            {c.authorId !== me && !c.held && <ReportDialog slug={context.slug} targetType="comment" targetId={c.id} name={name} compact />}
          </>} />; })}
      </PostComments>
    </PostCard>
  </div></div>;
}
