/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-footer.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Lock, Send, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/status-badge";
import { kindAction, replyReasonKey, type Conversation, type Eligibility, type InboxApi, type ReplyMode, type Receipt } from "@/lib/social/inbox";
import type { InboxKind } from "@/lib/social/platforms";
import { SocialApiError } from "@/lib/social/api";
import type { StatusTone } from "@/lib/status-tone";

export type ReplyTarget = { ref: string; mode: "comment" | "private" | "mention" };
const receiptTone: Record<string, StatusTone> = { queued: "pending", leased: "pending", dispatching: "pending", confirmed: "success", failed: "danger", unknown: "warning", cancelled: "neutral" };

/**
 * The reply box. The server decides whether a human reply is allowed (platform window, scope, account health); this shows its answer and the reason when
 * it says no. Sending itself is hard-off (`sendEnabled`): the box then explains that and the Send button stays disabled. Each reply intent gets one UUID, so
 * a retry sends the same request, and an `unknown` outcome never offers to send the same text again.
 */
export function InboxComposer({ api, itemId, kind, data, target, onClearTarget, sendEnabled, onSent }: {
  api: InboxApi; itemId: string; kind: InboxKind; data: Conversation; target: ReplyTarget | null; onClearTarget: () => void; sendEnabled: boolean; onSent: () => void;
}) {
  const t = useTranslations("SocialInbox.composer"), reasons = useTranslations("SocialInbox.composer.reasons"), format = useFormatter();
  const mode: ReplyMode = target?.mode ?? kindAction(kind), needsTarget = mode !== "message";
  const [text, setText] = useState(""), [checked, setChecked] = useState<{ key: string; result: Eligibility } | null>(null), [sentText, setSentText] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null), [sending, setSending] = useState(false), [problem, setProblem] = useState<"off" | "failed" | null>(null);
  const intent = useRef<string | null>(null);
  const key = target ? `${target.mode}:${target.ref}` : null, answer = checked && checked.key === key ? checked.result : null, checking = needsTarget && !!target && !answer;
  const eligibility: Eligibility | null = needsTarget ? (target ? answer : { allowed: false, reason: "select_target" }) : data.eligibility?.message ?? null;

  // A selected comment is checked with the server before anything can be written; state is set only when the answer arrives.
  useEffect(() => {
    if (!target || !key) return;
    const controller = new AbortController();
    api.eligibility(itemId, target.mode, target.ref, controller.signal)
      .then((result) => setChecked({ key, result: result.eligibility }))
      .catch(() => { if (!controller.signal.aborted) setChecked({ key, result: { allowed: false, reason: "unavailable" } }); });
    return () => controller.abort();
  }, [api, itemId, target, key]);

  // Poll the author's receipt while it is queued or in flight.
  useEffect(() => {
    if (!receipt || !["queued", "leased", "dispatching"].includes(receipt.state)) return;
    const controller = new AbortController(), timer = window.setTimeout(() => {
      api.receipt(itemId, receipt.id, controller.signal).then((result) => { setReceipt(result.reply); if (result.reply.state === "confirmed") onSent(); }).catch(() => undefined);
    }, 2_000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [api, itemId, receipt, onSent]);

  const allowed = eligibility?.allowed === true, locked = receipt?.state === "unknown" && text === sentText;
  const canSend = sendEnabled && allowed && !checking && !sending && !locked && text.trim().length > 0 && (!needsTarget || !!target);
  async function send() {
    if (!canSend) return;
    // One id per intent: the same text and target resubmit as the same request.
    intent.current ??= crypto.randomUUID();
    setSending(true); setProblem(null);
    try {
      const result = await api.reply(itemId, { id: intent.current, mode, targetRef: target?.ref ?? null, text: text.trim() });
      setSentText(text); setReceipt(result.reply); intent.current = null; setText(""); onClearTarget();
    } catch (failure) { setProblem(failure instanceof SocialApiError && failure.unavailable ? "off" : "failed"); }
    finally { setSending(false); }
  }
  const reason = eligibility && !eligibility.allowed ? reasons(replyReasonKey(eligibility.reason)) : null;
  const until = eligibility?.allowed && eligibility.expiresAt ? format.dateTime(new Date(eligibility.expiresAt), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

  return <form className="border-t bg-card p-4" data-testid="composer" data-eligible={allowed ? "yes" : "no"} onSubmit={(event) => { event.preventDefault(); void send(); }}>
    {target && <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-muted px-3 py-1.5 text-sm" data-testid="reply-target">
      <span>{t(`target.${target.mode}`)}</span>
      <Button type="button" variant="ghost" size="icon-responsive" aria-label={t("clearTarget")} onClick={onClearTarget}><X aria-hidden="true" /></Button></div>}
    <label htmlFor="inbox-reply" className="sr-only">{t("label")}</label>
    <Textarea id="inbox-reply" value={text} onChange={(event) => { setText(event.target.value); if (problem) setProblem(null); }} maxLength={10000} rows={2} className="max-h-48 min-h-20"
      disabled={!allowed || checking} placeholder={allowed ? t("placeholder") : reason ?? t("checking")} aria-describedby="reply-status" />
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p id="reply-status" className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground" role="status" data-testid="reply-status">
        {checking ? <><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("checking")}</>
          : reason ? <span data-testid="reply-reason" data-reason={eligibility && !eligibility.allowed ? eligibility.reason : undefined}>{reason}</span>
          : until ? <span>{t("until", { time: until })}</span> : null}
        {!sendEnabled && <span className="inline-flex items-center gap-1" data-testid="send-off"><Lock className="size-3.5" aria-hidden="true" />{t("off")}</span>}
      </p>
      <Button type="submit" size="responsive" disabled={!canSend} aria-disabled={!canSend}>{sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send aria-hidden="true" />}{t("send")}</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{t("rule")}</p>
    {problem && <Alert variant="destructive" role="alert" className="mt-3"><AlertDescription>{problem === "off" ? t("off") : t("failed")}</AlertDescription></Alert>}
    {receipt && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="receipt" role="status"><StatusBadge tone={receiptTone[receipt.state] ?? "neutral"} dot label={t(`receipt.${receipt.state}`)} />
      {receipt.state === "unknown" && <span className="text-muted-foreground">{t("receipt.unknownHelp")}</span>}</div>}
  </form>;
}
