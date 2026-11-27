/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/apps/social-media/components/post-item.tsx. Harvest changes: the kit card's client parts (the "..." menu, the like and comment actions with the like count, the comment input) wired to the existing forum routes in place of local state; the menu holds copy link, edit, pin, delete, remove and report; save, share, hide and unfollow are dropped; replies stay plain text with the forum's length limit. Notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Flag, Heart, Link2, MessageCircle, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "@/components/crm/request";
import { PostComposer, type ComposerCategory, type ComposerInitial, type ComposerPerson } from "@/components/forum/post-composer";
import { ReportDialog } from "@/components/communities/report-dialog";
import { memberInitials } from "@/lib/community-members";
import { forumLimits } from "@/lib/forum";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Request = ReturnType<typeof useCrmRequest>;
function useAction() {
  const request = useCrmRequest(), router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (call: (request: Request) => ReturnType<Request>, after?: () => void) => {
    setBusy(true); setError("");
    const result = await call(request);
    setBusy(false);
    if (!result.ok) { setError(result.error); return false; }
    if (after) after(); else router.refresh();
    return true;
  };
  return { busy, error, run, router };
}

/** The kit's like and comment buttons, with their counts inline as on a social post. Liking calls the forum's like route; share and save are not offered. */
export function PostEngagement({ slug, postId, title, likes, liked, likesOff, likeDisabled, replies, repliesHref, replyTarget }: { slug: string; postId: string; title: string;
  likes: number; liked: boolean; likesOff: boolean; likeDisabled: boolean; replies: number; repliesHref?: string; replyTarget?: string }) {
  const t = useTranslations("CommunityForum"), request = useCrmRequest();
  const [state, setState] = useState({ likes, liked }), [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    setBusy(true);
    const result = await request<{ liked: boolean }>(`/api/communities/${slug}/likes`, { method: "POST", body: { targetType: "post", targetId: postId } });
    setBusy(false);
    if (result.ok) setState((s) => ({ liked: result.data.liked, likes: s.likes + (result.data.liked ? 1 : -1) }));
  };

  const canLike = !likesOff && !likeDisabled;
  const action = "text-muted-foreground hover:text-foreground h-11 gap-1.5 rounded-full px-3 lg:h-9";
  return <div className="flex items-center gap-1 border-t pt-1 [&>:first-child]:-ms-3">
    {canLike && <Button
      variant="ghost"
      className={action}
      aria-pressed={state.liked} disabled={busy} aria-label={t(state.liked ? "unlikeNamed" : "likeNamed", { name: title })}
      onClick={() => void toggleLike()}>
      <Heart
        className={cn(state.liked && "fill-destructive text-destructive")} aria-hidden="true"
      />
      <span aria-hidden="true">{state.likes}</span>
    </Button>}
    {!canLike && !likesOff && <span className="text-muted-foreground inline-flex h-11 items-center gap-1.5 px-3 text-sm lg:h-9">
      <Heart className="size-4" aria-hidden="true" />{t("likeCount", { count: state.likes })}</span>}
    {repliesHref && <Button variant="ghost" className={action} asChild>
      <Link href={repliesHref} prefetch={false} aria-label={t("repliesNamed", { count: replies, name: title })}>
        <MessageCircle aria-hidden="true" />
        <span aria-hidden="true">{replies}</span>
      </Link>
    </Button>}
    {replyTarget && <Button
      variant="ghost"
      className={action} aria-label={t("writeReply")}
      onClick={() => document.getElementById(replyTarget)?.focus()}>
      <MessageCircle aria-hidden="true" />
      <span aria-hidden="true">{replies}</span>
    </Button>}
    {!repliesHref && !replyTarget && <span className="text-muted-foreground inline-flex h-11 items-center gap-1.5 px-3 text-sm lg:h-9">
      <MessageCircle className="size-4" aria-hidden="true" />{t("replies", { count: replies })}</span>}
  </div>;
}

/** The kit's "..." menu on a post: copy link for everyone, edit and delete for the author, pin and remove for hosts, report for other members. */
export function PostMenu({ slug, post, isAuthor, canModerate, edit, detail = false }: { slug: string; post: { id: string; title: string; pinned: boolean; held: boolean };
  isAuthor: boolean; canModerate: boolean; /** Author edit, offered on the post page only. */ edit?: { categories: ComposerCategory[]; initial: ComposerInitial; author: string; people?: ComposerPerson[] };
  /** On the post page: deleting or removing the post returns to the forum. */ detail?: boolean }) {
  const t = useTranslations("CommunityForum"), tr = useTranslations("Report"), { busy, run, router } = useAction();
  const [dialog, setDialog] = useState<"edit" | "report" | null>(null), trigger = useRef<HTMLButtonElement>(null);
  // The report and edit windows open from the menu with no trigger of their own: return focus to the menu button when they close.
  const closeDialog = () => { setDialog(null); requestAnimationFrame(() => trigger.current?.focus()); };
  const href = `/communities/${slug}/posts/${post.id}`, after = detail ? () => router.push(`/communities/${slug}/forum`) : undefined;
  const act = async (call: (request: Request) => ReturnType<Request>, done?: () => void) => {
    const failed = { message: "" };
    const ok = await run(async (request) => { const result = await call(request); if (!result.ok) failed.message = result.error; return result; }, done);
    if (!ok) notify.error(failed.message);
  };
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(new URL(href, window.location.origin).toString()); notify.success(t("linkCopied")); } catch { notify.error(t("copyFailed")); }
  };
  const canReport = !isAuthor && !post.held;
  return <>
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon-responsive" disabled={busy} aria-label={t("moreActions", { name: post.title })}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => void copyLink()}>
          <Link2 />
          {t("copyLink")}
        </DropdownMenuItem>
        {edit && <DropdownMenuItem className="min-h-11 lg:min-h-0" onSelect={() => setDialog("edit")}>
          <Pencil />
          {t("edit")}
        </DropdownMenuItem>}
        {canModerate && <DropdownMenuItem className="min-h-11 lg:min-h-0"
          onSelect={() => void act((r) => r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: post.pinned ? "unpin" : "pin", targetId: post.id } }))}>
          <Pin />
          {t(post.pinned ? "unpin" : "pin")}
        </DropdownMenuItem>}
        {(isAuthor || canModerate || canReport) && <DropdownMenuSeparator />}
        {isAuthor && <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-0"
          onSelect={() => void act((r) => r(`/api/communities/${slug}/posts/${post.id}`, { method: "DELETE" }), after)}>
          <Trash2 />
          {t("delete")}
        </DropdownMenuItem>}
        {canModerate && !isAuthor && <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-0"
          onSelect={() => void act((r) => r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: "remove_post", targetId: post.id } }), after)}>
          <Trash2 />
          {t("remove")}
        </DropdownMenuItem>}
        {canReport && <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-0" onSelect={() => setDialog("report")}>
          <Flag />
          {tr("action")}
        </DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
    {dialog === "report" && <ReportDialog slug={slug} targetType="post" targetId={post.id} name={post.title} defaultOpen onClose={closeDialog} />}
    {dialog === "edit" && edit && <PostComposer slug={slug} categories={edit.categories} canModerate={canModerate} initial={edit.initial} author={edit.author}
      people={edit.people} defaultOpen onClose={closeDialog} />}
  </>;
}

/** A reply's own actions, as the kit's small text actions under a comment: delete for its author, remove for hosts. */
export function CommentActions({ slug, commentId, isAuthor, canModerate, name }: { slug: string; commentId: string; isAuthor: boolean; canModerate: boolean; name: string }) {
  const t = useTranslations("CommunityForum"), { busy, run } = useAction();
  if (!isAuthor && !canModerate) return null;
  return <Button variant="ghost" className="text-muted-foreground hover:text-foreground min-h-11 px-2 text-xs font-medium" disabled={busy}
    aria-label={t(isAuthor ? "deleteReplyNamed" : "removeReplyNamed", { name })}
    onClick={() => void run((r) => isAuthor ? r(`/api/communities/${slug}/comments/${commentId}`, { method: "DELETE" })
      : r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: "remove_comment", targetId: commentId } }))}>{t(isAuthor ? "delete" : "remove")}</Button>;
}

/** The kit's "Add a comment" footer: the viewer's avatar, a borderless reply box and the send button. Enter sends; Shift+Enter starts a new line. */
export function ReplyForm({ slug, postId, me }: { slug: string; postId: string; me: string }) {
  const t = useTranslations("CommunityForum"), { busy, error, run, router } = useAction(), [body, setBody] = useState("");
  const handleAddComment = () => {
    const commentText = body.trim();
    if (!commentText || busy) return;
    void run((r) => r(`/api/communities/${slug}/posts/${postId}/comments`, { method: "POST", body: { body: commentText } }), () => { setBody(""); router.refresh(); });
  };
  return <form className="flex w-full flex-col gap-2" onSubmit={(e) => { e.preventDefault(); handleAddComment(); }}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <div className="flex items-center gap-2">
      <Avatar className="size-7">
        <AvatarFallback aria-hidden="true">{memberInitials(me)}</AvatarFallback>
      </Avatar>
      <Label htmlFor="reply-body" className="sr-only">{t("reply")}</Label>
      <Textarea
        id="reply-body" rows={1} maxLength={forumLimits.comment}
        placeholder={t("replyPlaceholder")}
        className="min-h-11 flex-1 resize-none border-0 bg-transparent px-2 py-3 shadow-none dark:bg-transparent"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault(); handleAddComment();
          }
        }}
      />
      <Button
        type="submit"
        variant="ghost"
        className="min-h-11"
        disabled={busy || !body.trim()}>
        {t("reply")}
      </Button>
    </div>
  </form>;
}
