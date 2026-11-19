"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { chatBody } from "@/lib/chat";
import type { DmFailure } from "@/lib/dm-view";
import { failureKey, startDirectMessage, useRetryId } from "./dm-api";

/**
 * The Message action on a member profile. It looks and behaves the same for every member: no lookup happens before sending, and the only
 * answer to a refusal is the neutral one. A sent first message opens the conversation.
 */
export function DmComposeDialog({ slug, targetUserId, name }: { slug: string; targetUserId: string; name: string }) {
  const t = useTranslations("CommunityDm"), router = useRouter();
  const [retryId, clearRetry] = useRetryId();
  const [open, setOpen] = useState(false), [body, setBody] = useState(""), [busy, setBusy] = useState(false), [failure, setFailure] = useState<DmFailure>();
  const valid = chatBody.safeParse(body.trim()).success;
  async function send() {
    if (!valid || busy) return;
    setBusy(true);
    setFailure(undefined);
    const text = body.trim();
    const result = await startDirectMessage(slug, targetUserId, text, retryId(`${targetUserId}:${text}`));
    if (!result.ok) { setBusy(false); setFailure(result.failure); return; }
    clearRetry();
    router.push(`/communities/${slug}/messages?c=${result.conversationId}`);
  }
  return <Dialog open={open} onOpenChange={next => { if (busy) return; setOpen(next); if (!next) { setBody(""); setFailure(undefined); } }}>
    <DialogTrigger asChild><Button className="mt-4 min-h-11"><MessageSquare aria-hidden="true" />{t("message")}</Button></DialogTrigger>
    <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{t("messageTo", { name })}</DialogTitle></DialogHeader>
      <Textarea value={body} maxLength={2000} rows={4} className="resize-none text-base" aria-label={t("writeTo", { name })} placeholder={t("writeTo", { name })}
        disabled={busy} onChange={event => { setBody(event.target.value); setFailure(undefined); }} />
      {failure && <Alert role="alert" variant="destructive"><AlertDescription>{t(failureKey[failure])}</AlertDescription></Alert>}
      <DialogFooter><Button className="min-h-11" disabled={!valid || busy} onClick={() => void send()}>{t("send")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
