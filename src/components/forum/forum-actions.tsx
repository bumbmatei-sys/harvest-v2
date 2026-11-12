"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCrmRequest } from "@/components/crm/request";
import { forumLimits } from "@/lib/forum";

type Request = ReturnType<typeof useCrmRequest>;
function useAction() {
  const request = useCrmRequest(), router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (call: (request: Request) => ReturnType<Request>, after?: () => void) => {
    setBusy(true); setError("");
    const result = await call(request);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    if (after) after(); else router.refresh();
  };
  return { busy, error, run, router };
}

/** Author delete, host pin/unpin/remove for a post. */
export function PostActions({ slug, postId, isAuthor, canModerate, pinned }: { slug: string; postId: string; isAuthor: boolean; canModerate: boolean; pinned: boolean }) {
  const t = useTranslations("CommunityForum"), { busy, error, run, router } = useAction();
  const back = () => router.push(`/communities/${slug}/forum`);
  return <div className="flex flex-wrap items-center gap-2">
    {error && <Alert variant="destructive" role="alert" className="w-full"><AlertDescription>{error}</AlertDescription></Alert>}
    {canModerate && <Button variant="outline" className="min-h-11" disabled={busy}
      onClick={() => void run((r) => r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: pinned ? "unpin" : "pin", targetId: postId } }))}>{t(pinned ? "unpin" : "pin")}</Button>}
    {isAuthor && <Button variant="outline" className="min-h-11" disabled={busy}
      onClick={() => void run((r) => r(`/api/communities/${slug}/posts/${postId}`, { method: "DELETE" }), back)}>{t("delete")}</Button>}
    {canModerate && !isAuthor && <Button variant="outline" className="min-h-11" disabled={busy}
      onClick={() => void run((r) => r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: "remove_post", targetId: postId } }), back)}>{t("remove")}</Button>}
  </div>;
}

export function CommentActions({ slug, commentId, isAuthor, canModerate, name }: { slug: string; commentId: string; isAuthor: boolean; canModerate: boolean; name: string }) {
  const t = useTranslations("CommunityForum"), { busy, run } = useAction();
  if (!isAuthor && !canModerate) return null;
  return <Button variant="ghost" className="min-h-11 px-3 text-muted-foreground" disabled={busy} aria-label={t(isAuthor ? "deleteReplyNamed" : "removeReplyNamed", { name })}
    onClick={() => void run((r) => isAuthor ? r(`/api/communities/${slug}/comments/${commentId}`, { method: "DELETE" })
      : r(`/api/communities/${slug}/moderation`, { method: "POST", body: { action: "remove_comment", targetId: commentId } }))}>{t(isAuthor ? "delete" : "remove")}</Button>;
}

export function ReplyForm({ slug, postId }: { slug: string; postId: string }) {
  const t = useTranslations("CommunityForum"), { busy, error, run, router } = useAction(), [body, setBody] = useState("");
  return <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void run((r) => r(`/api/communities/${slug}/posts/${postId}/comments`, { method: "POST", body: { body: body.trim() } }), () => { setBody(""); router.refresh(); }); }}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <Label htmlFor="reply-body" className="sr-only">{t("reply")}</Label>
    <Textarea id="reply-body" rows={3} maxLength={forumLimits.comment} value={body} placeholder={t("replyPlaceholder")} onChange={(e) => setBody(e.target.value)} />
    <div className="flex justify-end"><Button type="submit" className="min-h-11" disabled={busy || !body.trim()}>{t("reply")}</Button></div>
  </form>;
}
