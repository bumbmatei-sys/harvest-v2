/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/dashboard/(auth)/apps/mail/components/mail-display.tsx and apps/chat/components/chat-header.tsx, chat-bubbles.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, CheckCheck, EyeOff, Mail, MailOpen, Paperclip, RotateCw, ShieldAlert, Star, TriangleAlert, UserRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import UserAvatar from "@/components/user-avatar";
import { PlatformLogo } from "@/components/social/platform-logo";
import { InboxComposer, type ReplyTarget } from "@/components/social/inbox/inbox-composer";
import { accountProblem, kindAction, mergeMessages, type Conversation, type InboxApi, type InboxItem, type ItemChange, type ThreadMessage } from "@/lib/social/inbox";
import { SocialApiError } from "@/lib/social/api";
import { platformLabels } from "@/lib/social/labels";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Load = { status: "loading" } | { status: "error" } | { status: "gone" } | { status: "ready"; data: Conversation };
type LocalItem = Conversation["item"];

/**
 * The open conversation: header with the Harvest-only markers and actions, the messages exactly as the provider returns them right now (nothing is
 * stored, so a failure shows an error and never invented text), and the reply composer. Comment threads add per-comment actions.
 */
export function InboxThread({ tenantId, api, itemId, hint, me, assignees, sendEnabled, refreshKey, onBack, onChanged }: {
  tenantId: string; api: InboxApi; itemId: string; hint?: InboxItem; me: string; assignees: { id: string; name: string }[]; sendEnabled: boolean; refreshKey: number;
  onBack: () => void; onChanged: (id: string, version: number, fields: Partial<InboxItem>) => void;
}) {
  const t = useTranslations("SocialInbox"), format = useFormatter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [messages, setMessages] = useState<ThreadMessage[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [item, setItem] = useState<LocalItem | null>(null), [busy, setBusy] = useState(false), [target, setTarget] = useState<ReplyTarget | null>(null);
  const markedRead = useRef(false), seq = useRef(0);

  // State is set only after the request answers, so a load started by an effect never sets state synchronously. `retry` shows the skeleton first.
  const read = useCallback(async (quiet: boolean) => {
    const run = ++seq.current;
    try {
      const data = await api.conversation(itemId);
      if (run !== seq.current) return;
      setLoad({ status: "ready", data }); setItem(data.item); setMessages(mergeMessages([], data.messages ?? [])); setNextCursor(data.nextCursor ?? null); setMore("idle");
    } catch (error) {
      if (run !== seq.current) return;
      if (error instanceof SocialApiError && error.unavailable) setLoad({ status: "gone" });
      else setLoad((current) => quiet && current.status === "ready" ? current : { status: "error" });
    }
  }, [api, itemId]);
  const retry = () => { setLoad({ status: "loading" }); void read(false); };
  useEffect(() => { void Promise.resolve().then(() => read(true)); const current = seq; return () => { current.current++; }; }, [read]);
  useEffect(() => { if (refreshKey > 0) void Promise.resolve().then(() => read(true)); }, [refreshKey, read]);

  const change = useCallback(async (change: ItemChange, fields: Partial<InboxItem>, quiet = false) => {
    if (!item) return;
    setBusy(true);
    try {
      const result = await api.change(itemId, item.version, change);
      setItem((current) => current ? { ...current, ...fields, version: result.version } as LocalItem : current);
      onChanged(itemId, result.version, fields);
      if (!quiet) notify.success(t("changes.saved"));
    } catch (error) {
      if (error instanceof SocialApiError && error.conflict) { notify.error(t("changes.stale")); void read(true); }
      else notify.error(t("changes.failed"));
    } finally { setBusy(false); }
  }, [api, item, itemId, onChanged, read, t]);

  // Opening a conversation reads it in Harvest. The platform's own mailbox is never marked.
  useEffect(() => {
    if (load.status !== "ready" || load.data.state !== "available" || !item || item.readInHarvest || markedRead.current) return;
    markedRead.current = true; void change({ action: "read", value: true }, { readInHarvest: true }, true);
  }, [load, item, change]);

  async function loadMore() {
    if (!nextCursor) return;
    setMore("loading");
    try {
      const data = await api.conversation(itemId, nextCursor);
      setMessages((current) => mergeMessages(current, data.messages ?? [])); setNextCursor(data.nextCursor ?? null); setMore("idle");
    } catch (error) {
      if (error instanceof SocialApiError && error.conflict) { void read(true); return; }
      setMore("error");
    }
  }

  if (load.status === "loading") return <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" data-testid="thread-loading"><Header back={onBack} />
    <div className="space-y-4 p-4" role="status" aria-label={t("thread.loading")}>{[0, 1, 2].map((row) => <div key={row} className={cn("flex gap-3", row === 1 && "justify-end")}><Skeleton className="size-10 shrink-0 rounded-full" /><Skeleton className={cn("h-14 rounded-xl", row === 1 ? "w-2/3" : "w-3/4")} /></div>)}</div></div>;
  if (load.status === "gone") return <div className="flex min-h-0 flex-1 flex-col"><Header back={onBack} /><div className="p-4"><EmptyState icon={ShieldAlert} title={t("thread.goneTitle")} description={t("thread.gone")} solid /></div></div>;
  if (load.status === "error") return <div className="flex min-h-0 flex-1 flex-col"><Header back={onBack} /><div className="p-4"><Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-2">{t("thread.failed")}
    <Button type="button" variant="outline" size="responsive" onClick={retry}><RotateCw aria-hidden="true" />{t("retry")}</Button></AlertDescription></Alert></div></div>;

  const { data } = load, account = data.account, local = item ?? data.item, kind = local.kind, title = data.title ?? hint?.title ?? t(`kind.${kind}`);
  const delayed = data.state === "delayed", problem = data.state === "available" || delayed ? null : accountProblem({ state: data.state });
  const assigned = local.assigneeId, assignedName = assignees.find((person) => person.id === assigned)?.name;
  const accountName = account.displayName ?? platformLabels[account.platform];
  const comments = kind === "comment" || kind === "mention";
  const hideNote = kind === "comment" ? "hide-note" : undefined;

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="thread" data-state={data.state}>
    <Header back={onBack}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-card"><PlatformLogo platform={account.platform} colored className="size-5" /></span>
        <div className="min-w-0"><h2 className="truncate text-base font-semibold" tabIndex={-1} data-testid="thread-title">{title}</h2>
          <p className="truncate text-xs text-muted-foreground">{t("thread.meta", { platform: platformLabels[account.platform], account: accountName, kind: t(`kind.${kind}`) })}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {local.status === "done" && <StatusBadge tone="success" label={t("row.done")} />}
        {assigned && <StatusBadge tone="info" dot label={assigned === me ? t("row.assignedYou") : assignedName ? t("row.assignedTo", { name: assignedName }) : t("row.assigned")} />}
      </div>
    </Header>
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2" role="toolbar" aria-label={t("actions.label")}>
      <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => void change({ action: "read", value: !local.readInHarvest }, { readInHarvest: !local.readInHarvest })}>
        {local.readInHarvest ? <Mail aria-hidden="true" /> : <MailOpen aria-hidden="true" />}{local.readInHarvest ? t("actions.markUnread") : t("actions.markRead")}</Button>
      <Button type="button" variant="outline" size="responsive" disabled={busy} aria-pressed={local.starred} onClick={() => void change({ action: "star", value: !local.starred }, { starred: !local.starred })}>
        <Star aria-hidden="true" className={cn(local.starred && "fill-current")} />{local.starred ? t("actions.unstar") : t("actions.star")}</Button>
      <Button type="button" variant="outline" size="responsive" disabled={busy} onClick={() => void change({ action: "status", value: local.status === "done" ? "open" : "done" }, { status: local.status === "done" ? "open" : "done" })}>
        {local.status === "done" ? <RotateCw aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}{local.status === "done" ? t("actions.reopen") : t("actions.done")}</Button>
      <label className="flex items-center gap-2 text-sm"><span className="flex items-center gap-1.5 text-muted-foreground"><UserRound className="size-4" aria-hidden="true" />{t("actions.assign")}</span>
        <NativeSelect value={assigned ?? ""} disabled={busy} className="min-h-11 lg:min-h-9" onChange={(event) => { const value = event.target.value || null; void change({ action: "assign", assigneeId: value }, { assigneeId: value }); }}>
          <NativeSelectOption value="">{t("actions.unassigned")}</NativeSelectOption>
          {assignees.map((person) => <NativeSelectOption key={person.id} value={person.id}>{person.id === me ? t("actions.you", { name: person.name }) : person.name}</NativeSelectOption>)}
          {assigned && !assignees.some((person) => person.id === assigned) && <NativeSelectOption value={assigned}>{t("row.assigned")}</NativeSelectOption>}
        </NativeSelect></label>
    </div>

    {problem && <div className="p-4"><Alert variant="attention" role="alert" data-testid="thread-problem"><TriangleAlert aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">{t(`thread.problem.${problem}`)}
      {(problem === "expired" || problem === "unhealthy" || problem === "disabled") && <Link href={`/workspaces/${tenantId}/social/accounts`} prefetch={false} className="font-medium underline underline-offset-2">{t("manageAccounts")}</Link>}</AlertDescription></Alert></div>}
    {delayed && <div className="p-4"><Alert role="status" data-testid="thread-delayed"><RotateCw aria-hidden="true" /><AlertDescription className="flex flex-wrap items-center gap-2">{t("thread.delayed", { seconds: data.retryAfter ?? 2 })}
      <Button type="button" variant="outline" size="responsive" onClick={retry}>{t("retry")}</Button></AlertDescription></Alert></div>}

    {!problem && !delayed && <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="messages" role="region" aria-label={t("thread.messages")} tabIndex={0}>
        {nextCursor && <div className="mb-4 flex justify-center"><Button type="button" variant="outline" size="responsive" disabled={more === "loading"} onClick={() => void loadMore()}>{more === "loading" ? t("loadingMore") : t("thread.loadMore")}</Button></div>}
        {more === "error" && <Alert variant="destructive" role="alert" className="mb-4"><AlertDescription>{t("thread.moreFailed")}</AlertDescription></Alert>}
        {messages.length === 0
          ? <EmptyState size="compact" icon={Mail} title={t("thread.noMessages")} />
          : <ol className="flex flex-col gap-4">
              {messages.map((message) => <li key={message.ref}>{comments
                ? <CommentRow message={message} kind={kind} selected={target?.ref === message.ref} describedBy={hideNote} onTarget={(mode) => setTarget({ ref: message.ref, mode })} />
                : <MessageRow message={message} name={title} format={format} />}</li>)}
            </ol>}
      </div>
      {kind === "comment" && <p id="hide-note" className="border-t px-4 py-2 text-xs text-muted-foreground" data-testid="hide-note">{t("comment.hideUnavailable")}</p>}
      <InboxComposer key={`${itemId}`} api={api} itemId={itemId} kind={kind} data={data} target={target} onClearTarget={() => setTarget(null)} sendEnabled={sendEnabled} onSent={() => void read(true)} />
    </>}
    {(problem || delayed) && <div className="min-h-0 flex-1" />}
  </div>;
}

function Header({ back, children }: { back: () => void; children?: React.ReactNode }) {
  const t = useTranslations("SocialInbox");
  return <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
    <Button type="button" variant="ghost" size="icon-responsive" className="md:hidden" aria-label={t("thread.back")} onClick={back}><ArrowLeft aria-hidden="true" /></Button>
    {children}
  </header>;
}

const time = (value: string | null, format: ReturnType<typeof useFormatter>) => value ? format.dateTime(new Date(value), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

/** One direct message or story reply as a bubble (kit chat layout): incoming on the left with the person's initials, outgoing on the right. */
function MessageRow({ message, name, format }: { message: ThreadMessage; name: string; format: ReturnType<typeof useFormatter> }) {
  const t = useTranslations("SocialInbox"), mine = message.direction === "outgoing", when = time(message.at, format);
  return <article className={cn("flex min-w-0 gap-2.5", mine && "flex-row-reverse")} data-testid="message" data-direction={message.direction}>
    {!mine && <UserAvatar name={name} className="mt-0.5 shrink-0" />}
    <div className={cn("flex min-w-0 max-w-[min(85%,38rem)] flex-1 flex-col gap-1", mine ? "items-end" : "items-start")}>
      <Bubble align={mine ? "end" : "start"} variant={mine ? "default" : "muted"} className="max-w-full">
        <BubbleContent className={cn("whitespace-pre-wrap break-words", message.deleted && "italic")}>
          <span className="sr-only">{mine ? t("thread.sent") : t("thread.received")} </span>{message.deleted ? t("thread.deleted") : message.text ?? ""}
          {message.attachments.length > 0 && <span className="mt-1 flex flex-wrap gap-1.5">{message.attachments.map((attachment, index) => <span key={index} className="inline-flex items-center gap-1 rounded-md bg-background/60 px-1.5 py-0.5 text-xs text-foreground"><Paperclip className="size-3" aria-hidden="true" />{attachment.name ?? t(`attachment.${attachment.type in { image: 1, video: 1, audio: 1 } ? attachment.type : "file"}`)}</span>)}</span>}
        </BubbleContent>
      </Bubble>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        {when && <time dateTime={message.at ?? undefined}>{when}</time>}
        {message.storyReply && <span>{t("thread.storyReply")}</span>}{message.storyMention && <span>{t("thread.storyMention")}</span>}
        {mine && message.deliveryStatus && <span className="inline-flex items-center gap-1"><Check className="size-3" aria-hidden="true" />{t(`delivery.${message.deliveryStatus}`)}</span>}
      </div>
    </div>
  </article>;
}

/** A comment or mention with the actions the provider allows for it. A missing action says so; nothing is hidden silently. */
function CommentRow({ message, kind, selected, describedBy, onTarget }: { message: ThreadMessage; kind: "comment" | "mention" | "dm" | "story"; selected: boolean; describedBy?: string; onTarget: (mode: "comment" | "private" | "mention") => void }) {
  const t = useTranslations("SocialInbox"), format = useFormatter(), caps = message.capabilities, when = time(message.at, format);
  const replyMode = kindAction(kind) === "mention" ? "mention" : "comment";
  const canReply = replyMode === "mention" ? !!caps?.mentionReply : !!caps?.commentReply;
  return <article className={cn("rounded-lg border bg-card p-3", selected && "border-primary ring-1 ring-primary/40")} data-testid="comment" data-selected={selected}>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{t(`kind.${kind}`)}</span>{when && <time dateTime={message.at ?? undefined} className="tabular-nums">{when}</time>}</div>
    <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-sm", message.deleted && "italic text-muted-foreground")}>{message.deleted ? t("thread.deleted") : message.text ?? ""}</p>
    {message.attachments.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">{message.attachments.map((attachment, index) => <span key={index} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs"><Paperclip className="size-3" aria-hidden="true" />{attachment.name ?? t(`attachment.${attachment.type in { image: 1, video: 1, audio: 1 } ? attachment.type : "file"}`)}</span>)}</p>}
    {!message.deleted && <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="responsive" disabled={!canReply} aria-pressed={selected} onClick={() => onTarget(replyMode)}>{t("comment.reply")}</Button>
      {kind === "comment" && <Button type="button" variant="outline" size="responsive" disabled={!caps?.privateReply} onClick={() => onTarget("private")}>{t("comment.replyPrivately")}</Button>}
      {kind === "comment" && <Button type="button" variant="outline" size="responsive" disabled aria-describedby={describedBy}><EyeOff aria-hidden="true" />{t("comment.hide")}</Button>}
      {(!canReply || (kind === "comment" && !caps?.privateReply)) && <span className="text-xs text-muted-foreground" data-testid="comment-unavailable">{!canReply ? t("comment.replyUnavailable") : t("comment.privateUnavailable")}</span>}
    </div>}
  </article>;
}
