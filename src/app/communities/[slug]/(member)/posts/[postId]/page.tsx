import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, FileText, Pin } from "lucide-react";
import { getDb } from "@/db/client";
import { getPost } from "@/server/community-forum";
import { pageSession } from "@/server/page-session";
import { communitiesEnabled } from "@/server/communities-mode";
import { AccessError } from "@/server/permissions";
import { notFound } from "next/navigation";
import { RichTextView } from "@/components/rich-text/rich-text-view";
import { VideoEmbedView } from "@/components/forum/video-embed";
import { LikeButton } from "@/components/forum/like-button";
import { CommentActions, PostActions, ReplyForm } from "@/components/forum/forum-actions";
import { PostComposer } from "@/components/forum/post-composer";
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
  const isAuthor = post.authorId === me, author = post.authorName?.trim() || t("unnamed"), muted = context.mutedUntil;
  const awaiting = <Badge variant="outline">{t("awaitingReview")}</Badge>;
  return <article className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-6">
    <Link href={`/communities/${context.slug}/forum`} prefetch={false} className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" aria-hidden="true" />{t("backToForum")}</Link>
    {/* eslint-disable-next-line @next/next/no-img-element -- authenticated redirect to a short-lived signed URL; not optimisable */}
    {post.coverFileId && <img src={`${files}/${post.coverFileId}`} alt="" className="aspect-[2/1] w-full rounded-lg border object-cover" />}
    <header className="space-y-2">
      {(post.pinned || post.held) && <div className="flex flex-wrap gap-2">{post.pinned && <Badge variant="secondary"><Pin className="size-3" aria-hidden="true" />{t("pinned")}</Badge>}
        {post.held && awaiting}</div>}
      <h2 className="text-2xl font-semibold break-words">{post.title}</h2>
      <div className="flex flex-wrap items-center gap-x-2">
        <p className="text-sm text-muted-foreground">{t(post.editedAt ? "bylineEdited" : "byline", { name: author, date: format.dateTime(post.createdAt, { dateStyle: "medium" }) })}</p>
        {post.editedAt && context.canModerate && <EditHistory slug={context.slug} targetType="post" targetId={post.id} name={post.title} compact />}
      </div>
    </header>
    {post.video && <VideoEmbedView video={post.video} title={post.title} />}
    <RichTextView doc={post.body} />
    {attachments.length > 0 && <section aria-labelledby="post-attachments" className="space-y-2">
      <h3 id="post-attachments" className="text-sm font-medium">{t("attachments")}</h3>
      <ul className="space-y-2">{attachments.map((a) => <li key={a.id}><a href={`${files}/${a.id}`} className="flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm hover:bg-muted">
        <FileText className="size-4" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{a.name}</span></a></li>)}</ul></section>}
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <LikeButton slug={context.slug} targetType="post" targetId={post.id} likes={post.likes} liked={post.liked} disabled={post.likesOff || post.held || Boolean(muted)} label={post.title} />
      <div className="ml-auto flex flex-wrap gap-2">
        {!isAuthor && !post.held && <ReportDialog slug={context.slug} targetType="post" targetId={post.id} name={post.title} />}
        {isAuthor && !muted && <PostComposer slug={context.slug} categories={context.categories} canModerate={context.canModerate} initial={{ id: post.id, categoryId: post.categoryId, title: post.title,
          body: post.body, videoUrl: post.videoUrl, cover: post.coverFileId ? { id: post.coverFileId, name: t("currentCover") } : null,
          attachments: attachments.map((a) => ({ id: a.id, name: a.name })), commentsOff: post.commentsOff, likesOff: post.likesOff }} />}
        <PostActions slug={context.slug} postId={post.id} isAuthor={isAuthor} canModerate={context.canModerate} pinned={post.pinned} />
      </div>
    </div>
    <section aria-labelledby="post-replies" className="space-y-4">
      <h3 id="post-replies" className="text-base font-semibold">{t("replies", { count: comments.length })}</h3>
      {comments.length > 0 && <ul className="space-y-3">{comments.map((c) => { const name = c.authorName?.trim() || t("unnamed"); return <li key={c.id} className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm text-muted-foreground">{t("byline", { name, date: format.dateTime(c.createdAt, { dateStyle: "medium" }) })}</p>
          {c.held && awaiting}</div>
        <p className="mt-1 text-sm whitespace-pre-line break-words">{c.body}</p>
        <div className="mt-1 flex items-center gap-1">
          <LikeButton slug={context.slug} targetType="comment" targetId={c.id} likes={c.likes} liked={c.liked} disabled={post.likesOff || c.held || Boolean(muted)} label={name} />
          <CommentActions slug={context.slug} commentId={c.id} isAuthor={c.authorId === me} canModerate={context.canModerate} name={name} />
          {context.canModerate && c.edits > 0 && <EditHistory slug={context.slug} targetType="comment" targetId={c.id} name={name} compact />}
          {c.authorId !== me && !c.held && <ReportDialog slug={context.slug} targetType="comment" targetId={c.id} name={name} compact />}
        </div></li>; })}</ul>}
      {post.held ? null : post.commentsOff ? <p className="text-sm text-muted-foreground">{t("commentsClosed")}</p>
        : muted ? <Alert><AlertDescription>{t("mutedUntil", { date: format.dateTime(muted, { dateStyle: "medium", timeStyle: "short" }) })}</AlertDescription></Alert>
        : <ReplyForm slug={context.slug} postId={post.id} />}
    </section>
  </article>;
}
