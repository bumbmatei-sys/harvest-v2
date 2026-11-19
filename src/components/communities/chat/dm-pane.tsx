/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-content.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { MessageScrollerItem } from "@/components/ui/message-scroller";
import { retryAfterDelay, usePolling } from "@/hooks/use-polling";
import { chatDraftPayload, ChatComposer, emptyChatDraft, type ChatDraft } from "./chat-composer";
import { failureKey, useRetryId } from "./dm-api";
import { DmMessageRow, type DmAction } from "./dm-message";
import { chatRequest, LiveMessageNotice, MessageList, ReadState } from "./message-list";
import { dmFailure, dmName, mergeDmMessages, type DmConversation, type DmMessage, type DmPage } from "@/lib/dm-view";

const retryDeadline = (delay: number) => performance.now() + delay;
const secondsRemaining = (deadline: number) => Math.ceil((deadline - performance.now()) / 1000);

const seqBefore = (rows: DmMessage[]) =>
  rows.reduce<string | null>((oldest, row) => oldest === null || BigInt(row.seq) < BigInt(oldest) ? row.seq : oldest, null);

/** One private conversation: the shared message list and composer, with the participant-only actions around them. */
export function DmPane({ slug, me, conversation, policy, blocked, online, focused, draft, setDraft, onRead, onUnblock, afterReport }: {
  slug: string;
  me: string;
  conversation: DmConversation;
  policy: "channels_only" | "members";
  /** The viewer blocked the other person. The other person is never told. */
  blocked: boolean;
  online: boolean;
  focused: boolean;
  draft: ChatDraft;
  setDraft: (draft: ChatDraft) => void;
  onRead: () => void;
  onUnblock: () => void;
  afterReport?: (close: () => void) => React.ReactNode;
}) {
  const t = useTranslations("CommunityDm");
  const endpoint = `/api/communities/${slug}/chat/dms/${conversation.id}`;
  const name = dmName(conversation, t("formerMember"));
  const [retryId, clearRetry] = useRetryId();
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [history, setHistory] = useState<{ before: string | null; more: boolean } | null>(null);
  const [paging, setPaging] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);
  const [announcement, setAnnouncement] = useState<DmMessage>();
  const [denied, setDenied] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<{ message: DmMessage; draft: ChatDraft }>();
  const [confirm, setConfirm] = useState<DmMessage>();
  const [pending, setPending] = useState<{ id: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const cursor = useRef<string | null>(null), tag = useRef<string | null>(null);
  const latestSeq = useRef(0n);
  const retryUntil = useRef(0);
  const sendable = conversation.canSend && !blocked;

  const refresh = usePolling({
    resource: endpoint,
    mode: "active",
    poll: async signal => {
      const since = cursor.current;
      const response = await fetch(`${endpoint}/messages${since === null ? "" : `?since=${since}`}`, {
        cache: "no-store", signal, headers: tag.current ? { "If-None-Match": tag.current } : undefined,
      });
      if (!response.ok) return response;
      const page: DmPage = await response.json();
      if (signal.aborted) return response;
      if (since === null) setHistory({ before: seqBefore(page.events), more: page.hasMore });
      cursor.current = page.cursor;
      tag.current = response.headers.get("ETag");
      setMessages(current => mergeDmMessages(current, page.events));
      const fresh = page.events.reduce<DmMessage | undefined>((latest, event) => !latest || BigInt(event.seq) > BigInt(latest.seq) ? event : latest, undefined);
      if (fresh && BigInt(fresh.seq) > latestSeq.current) {
        latestSeq.current = BigInt(fresh.seq);
        if (since !== null && fresh.authorId !== me && !fresh.deletedAt) setAnnouncement(fresh);
      }
      const more = since !== null && page.hasMore;
      setCaughtUp(!more);
      return { status: response.status, headers: response.headers, activity: page.events.length > 0, more };
    },
    onStop: setDenied,
  });

  const visible = useMemo(() => messages.filter(item => history?.before == null || BigInt(item.seq) >= BigInt(history.before)), [messages, history]);
  const latestLoaded = messages.reduce<DmMessage | undefined>((latest, item) =>
    item.deletedAt || latest && BigInt(item.seq) <= BigInt(latest.seq) ? latest : item, undefined);

  const reportFailure = (status: number, outcome: unknown, headers?: Headers) => {
    const failure = dmFailure(status, outcome);
    if (failure === "slow") {
      const delay = retryAfterDelay(headers?.get("Retry-After") ?? null) || 10_000;
      retryUntil.current = retryDeadline(delay);
      setError(t("slowDown", { seconds: Math.ceil(delay / 1000) }));
    } else setError(t(failureKey[failure]));
  };

  async function earlier() {
    if (!history?.before) return;
    setPaging(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/messages?before=${history.before}`, { cache: "no-store" });
      if (!response.ok) return reportFailure(response.status, undefined, response.headers);
      const page: DmPage = await response.json();
      setMessages(current => mergeDmMessages(current, page.events));
      setHistory({ before: seqBefore(page.events) ?? history.before, more: page.hasMore });
    } catch { setError(t("sendFailed")); }
    finally { setPaging(false); }
  }

  async function send() {
    const active = edit ? edit.draft : draft;
    if (!online || busy || !sendable) return;
    const remaining = secondsRemaining(retryUntil.current);
    if (!edit && remaining > 0) { setError(t("slowDown", { seconds: remaining })); return; }
    const { body } = chatDraftPayload(active);
    setBusy(true);
    setError("");
    if (!edit) setPending({ id: retryId(`${conversation.id}:${body}`), text: active.text });
    try {
      const response = edit
        ? await chatRequest(`/api/communities/${slug}/chat/dms/messages/${edit.message.id}`, "PATCH", { body })
        : await chatRequest(`${endpoint}/messages`, "POST", { body, client_id: retryId(`${conversation.id}:${body}`) });
      const result = await response.json().catch(() => ({})) as { outcome?: string; message?: DmMessage };
      if (!response.ok || !result.message) return reportFailure(response.status, result.outcome, response.headers);
      setMessages(current => mergeDmMessages(current, [result.message!]));
      if (edit) setEdit(undefined); else { setDraft(emptyChatDraft); clearRetry(); }
      refresh();
    } catch { setError(t("sendFailed")); }
    finally { setBusy(false); setPending(undefined); }
  }

  async function mutate(message: DmMessage, action: DmAction) {
    setError("");
    try {
      const url = `/api/communities/${slug}/chat/dms/messages/${message.id}`;
      const response = action === "delete" ? await chatRequest(url, "DELETE") : await chatRequest(`${url}/restore`, "POST");
      if (!response.ok) { reportFailure(response.status, undefined, response.headers); return false; }
      refresh();
      return true;
    } catch { setError(t("actionFailed")); return false; }
  }

  if (denied) return <div className="flex flex-1 items-center justify-center p-6">
    <p role="status" className="text-center text-sm text-muted-foreground">{t(denied === 401 ? "signIn" : "notAvailable")}</p></div>;

  const composerDraft = edit ? edit.draft : draft;
  const inlineError = error && <Alert role="alert" variant="destructive" className="mx-3 my-1 w-auto"><AlertDescription>{error}</AlertDescription></Alert>;
  return <>
    <MessageList label={t("messagesWith", { name })}
      onLatest={<><ReadState seq={latestLoaded?.seq} enabled={online && focused && caughtUp} endpoint={`${endpoint}/read`} onRead={onRead} />
        <LiveMessageNotice latest={announcement && { id: announcement.id, name }} enabled={caughtUp} /></>}>
      {history?.more && <Button variant="outline" className="min-h-11 self-center" disabled={paging || !online} onClick={() => void earlier()}>{t("older")}</Button>}
      {!history ? <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>
        : !visible.length && !history.more && <p className="text-sm text-muted-foreground">{t("emptyMessages")}</p>}
      {visible.map(item => <MessageScrollerItem key={item.id} messageId={item.id}>
        <DmMessageRow message={item} slug={slug} conversationId={conversation.id} mine={item.authorId === me} name={name} canEdit={sendable && online}
          afterReport={afterReport} onEdit={() => setEdit({ message: item, draft: { text: item.body ?? "", mentions: [] } })}
          onAction={action => action === "delete" ? setConfirm(item) : void mutate(item, action)} />
      </MessageScrollerItem>)}
      {pending && !messages.some(item => item.clientId === pending.id) && <MessageScrollerItem messageId={pending.id}>
        <Bubble align="end" variant="tinted"><BubbleContent>{pending.text}</BubbleContent>
          <span className="self-end text-xs text-muted-foreground">{t("sending")}</span></Bubble></MessageScrollerItem>}
    </MessageList>
    {inlineError}
    {blocked ? <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
        <p className="text-sm text-muted-foreground">{t("youBlocked", { name })}</p>
        <Button variant="outline" className="min-h-11" onClick={onUnblock}>{t("unblock")}</Button>
      </div>
      : !conversation.canSend ? <p role="status" className="shrink-0 border-t px-4 py-3 text-sm text-muted-foreground">{t(policy === "channels_only" ? "readOnlyOff" : "readOnly")}</p>
      : <ChatComposer members={[]} mentionable={false} label={edit ? t("edit") : t("message")} draft={composerDraft} busy={busy} blocked={!online}
        mode={edit ? "edit" : "send"} onCancel={edit ? () => setEdit(undefined) : undefined} onSend={() => void send()}
        onChange={next => { if (edit) setEdit({ ...edit, draft: next }); else setDraft(next); }} />}
    <ConfirmDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(undefined); }} tone="destructive"
      title={t("deleteMessage")} description={t("deleteDescription")} cancelLabel={t("cancel")} confirmLabel={t("deleteMessage")}
      onConfirm={async () => { if (confirm && !await mutate(confirm, "delete")) return t("actionFailed"); }} />
  </>;
}
