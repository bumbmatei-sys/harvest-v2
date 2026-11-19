/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-content.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Pin } from "lucide-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport, useMessageScrollerScrollable } from "@/components/ui/message-scroller";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { usePolling, retryAfterDelay } from "@/hooks/use-polling";
import { channelEligible, chatTokens } from "@/lib/chat";
import { canActOn } from "@/lib/moderation";
import type { ChatChannelSetting } from "@/lib/chat-view";
import { mergeChatMessages, type ChatAccess, type ChatChannel, type ChatMessage, type ChatPage } from "@/lib/chat-view";
import type { DirectoryMember } from "@/server/community-forum";
import { ChannelInfo } from "./channel-info";
import { MemberProfileSheet, type ProfilePerson } from "./member-profile-sheet";
import { ChatComposer, chatDraftPayload, emptyChatDraft, type ChatDraft } from "./chat-composer";
import { ChatMessageRow, type ChatAction } from "./chat-message";

async function chatRequest(path: string, method: string, body?: unknown) {
  return fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
}

const retryDeadline = (delay: number) => performance.now() + delay;
const secondsRemaining = (deadline: number) => Math.ceil((deadline - performance.now()) / 1000);

const seqBefore = (rows: ChatMessage[]) =>
  rows.reduce<string | null>((oldest, row) => oldest === null || BigInt(row.seq) < BigInt(oldest) ? row.seq : oldest, null);

function ReadState({ seq, enabled, endpoint, onRead }: { seq?: string; enabled: boolean; endpoint: string; onRead: () => void }) {
  const { end } = useMessageScrollerScrollable();
  const sent = useRef("0");
  useEffect(() => {
    if (end || !enabled || !seq || BigInt(seq) <= BigInt(sent.current)) return;
    let active = true;
    const timer = setTimeout(async () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      try {
        const response = await chatRequest(endpoint, "PUT", { upTo: seq });
        if (response.ok && active) {
          sent.current = seq;
          onRead();
        }
      } catch { /* A later revision or focus change can retry. */ }
    }, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [enabled, end, endpoint, onRead, seq]);
  return null;
}

function MessageList({ children, label, className, onLatest }: {
  children: React.ReactNode;
  label: string;
  className?: string;
  onLatest?: React.ReactNode;
}) {
  const t = useTranslations("CommunityChat");
  return <MessageScrollerProvider autoScroll defaultScrollPosition="end">
    <MessageScroller className={className}>
      <MessageScrollerViewport aria-label={label} role="region">
        <MessageScrollerContent className="p-3 md:p-4" role="presentation" aria-live="off">{children}</MessageScrollerContent>
      </MessageScrollerViewport>
      <MessageScrollerButton label={t("jumpLatest")} />
      {onLatest}
    </MessageScroller>
  </MessageScrollerProvider>;
}

function LiveMessageNotice({ latest, enabled }: { latest?: ChatMessage; enabled: boolean }) {
  const t = useTranslations("CommunityChat");
  const { end } = useMessageScrollerScrollable();
  return <div role="log" aria-label={t("newMessages")} aria-live={enabled && !end ? "polite" : "off"} aria-relevant="additions text" className="sr-only">
    {latest && <span key={latest.id}>{t("newMessageFrom", { name: latest.authorName || t("formerMember") })}</span>}
  </div>;
}

export function MessagePane({ channel, slug, me, access, members, draft, setDraft, retryIds, online, focused, onRead, info }: {
  channel: ChatChannel;
  slug: string;
  me: string;
  access: ChatAccess;
  members: DirectoryMember[];
  draft: ChatDraft;
  setDraft: (draft: ChatDraft) => void;
  retryIds: RefObject<Map<string, { request: string; id: string }>>;
  online: boolean;
  focused: boolean;
  onRead: () => void;
  /** Channel info panel: its open state lives with the header button that opens it. */
  info: { open: boolean; returnFocus: RefObject<HTMLElement | null>; onOpenChange: (open: boolean) => void; setting?: ChatChannelSetting; onMute: (value: "none" | "mentions_only" | "all") => void; onEdit?: () => void };
}) {
  const t = useTranslations("CommunityChat");
  const base = `/api/communities/${slug}/chat`, endpoint = `${base}/channels/${channel.id}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pins, setPins] = useState<ChatMessage[]>([]);
  const [history, setHistory] = useState<{ before: string | null; more: boolean } | null>(null);
  const [paging, setPaging] = useState(false);
  const [caughtUp, setCaughtUp] = useState(false);
  const [announcement, setAnnouncement] = useState<ChatMessage>();
  const [denied, setDenied] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [thread, setThread] = useState<string>();
  const [replies, setReplies] = useState<{ before: string | null; more: boolean }>();
  const [threadDraft, setThreadDraft] = useState<ChatDraft>(emptyChatDraft);
  const [edit, setEdit] = useState<{ message: ChatMessage; draft: ChatDraft }>();
  const [confirm, setConfirm] = useState<{ message: ChatMessage; action: "delete" | "remove" }>();
  const [pending, setPending] = useState<{ id: string; text: string; thread?: string }>();
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<ProfilePerson>();
  const profileReturn = useRef<HTMLElement | null>(null);
  const cursor = useRef<string | null>(null), tag = useRef<string | null>(null);
  const latestRootSeq = useRef(0n);
  const threadRequest = useRef(0);
  const threadOpener = useRef<HTMLButtonElement | null>(null);
  const retryUntil = useRef(0);
  const post = !access.muted && (channel.posting === "members" || access.moderate);

  const refresh = usePolling({
    resource: endpoint,
    mode: "active",
    poll: async signal => {
      const since = cursor.current;
      const response = await fetch(`${endpoint}/messages${since === null ? "" : `?since=${since}`}`, {
        cache: "no-store", signal, headers: tag.current ? { "If-None-Match": tag.current } : undefined,
      });
      if (!response.ok) return response;
      const page: ChatPage = await response.json();
      if (signal.aborted) return response;
      cursor.current = page.cursor;
      tag.current = response.headers.get("ETag");
      if (since === null) setHistory({ before: seqBefore(page.events), more: page.hasMore });
      setMessages(current => mergeChatMessages(current, page.events));
      const fresh = page.events.reduce<ChatMessage | undefined>((latest, event) =>
        !event.parentId && (!latest || BigInt(event.seq) > BigInt(latest.seq)) ? event : latest, undefined);
      if (fresh && BigInt(fresh.seq) > latestRootSeq.current) {
        latestRootSeq.current = BigInt(fresh.seq);
        if (since !== null && fresh.authorId !== me && !fresh.deletedAt && !fresh.heldAt) setAnnouncement(fresh);
      }
      const more = since !== null && page.hasMore;
      setCaughtUp(!more);
      // Pins can predate the current history window. Refresh only after the initial read or a changed page.
      if (!more && (since === null || page.events.length)) {
        const selection = await fetch(`${endpoint}/selection`, { signal, cache: "no-store" });
        if (selection.ok) {
          const result: ChatPage = await selection.json();
          if (!signal.aborted) setPins(result.events);
        }
      }
      return { status: response.status, headers: response.headers, activity: page.events.length > 0, more };
    },
    onStop: setDenied,
  });

  const visible = useMemo(() => messages.filter(item => !item.parentId && (history?.before == null || BigInt(item.seq) >= BigInt(history.before))), [messages, history]);
  const allowedMentions = useMemo(() => members.filter(member => member.userId !== me &&
    (channel.accessMode === "all" || channel.accessMode === "invite" && messages.some(item => item.authorId === member.userId) ||
      channel.accessMode === "role" && channelEligible({ active: true, grant: true, role: member.role,
        accessMode: "role", minRole: channel.minRole ?? "member", invited: false, archived: false })))
    .map(member => ({ id: member.userId, name: member.name })), [channel, me, members, messages]);
  // The unread count covers thread replies too, so the channel's read mark follows the newest loaded message (root or reply).
  // Replies count as read once the channel is caught up and scrolled to its end; opening the thread is not required.
  const latestLoaded = messages.reduce<ChatMessage | undefined>((latest, item) =>
    item.deletedAt || item.heldAt || latest && BigInt(item.seq) <= BigInt(latest.seq) ? latest : item, undefined);
  const threadMessages = thread ? messages.filter(item => item.id === thread ||
    item.parentId === thread && (replies?.before == null || BigInt(item.seq) >= BigInt(replies.before))) : [];
  const displayPins = pins.filter(item => !messages.some(message => message.id === item.id && (!message.pinnedAt || message.deletedAt)));
  const reportError = (response: Response) => {
    if (response.status === 429) {
      const delay = retryAfterDelay(response.headers.get("Retry-After")) || 10_000;
      retryUntil.current = retryDeadline(delay);
      setError(t("slowDown", { seconds: Math.ceil(delay / 1000) }));
    } else {
      setError(t(response.status === 401 ? "signIn" : response.status === 403 ? "forbidden" : "actionFailed"));
    }
  };

  async function earlier() {
    if (!history?.before) return;
    setPaging(true);
    setError("");
    try {
      const response = await fetch(`${endpoint}/messages?before=${history.before}`, { cache: "no-store" });
      if (!response.ok) return reportError(response);
      const page: ChatPage = await response.json();
      setMessages(current => mergeChatMessages(current, page.events));
      setHistory({ before: seqBefore(page.events) ?? history.before, more: page.hasMore });
    } catch { setError(t("actionFailed")); }
    finally { setPaging(false); }
  }

  async function openThread(root: ChatMessage, before?: string | null) {
    const request = ++threadRequest.current;
    setThread(root.parentId ?? root.id);
    if (!before) {
      setReplies(undefined);
      setThreadDraft(emptyChatDraft);
    }
    setMessages(current => mergeChatMessages(current, [root]));
    setError("");
    try {
      const id = root.parentId ?? root.id;
      const response = await fetch(`${endpoint}/selection?thread=${id}${before ? `&before=${before}` : ""}`, { cache: "no-store" });
      if (request !== threadRequest.current) return;
      if (!response.ok) return reportError(response);
      const result: ChatPage = await response.json();
      if (request !== threadRequest.current) return;
      setMessages(current => mergeChatMessages(current, result.events));
      setReplies({ before: seqBefore(result.events.filter(item => item.parentId === id)), more: result.hasMore });
    } catch { setError(t("actionFailed")); }
  }

  async function send(inThread = false) {
    const activeEdit = edit && (inThread ? threadMessages.some(item => item.id === edit.message.id) : !edit.message.parentId) ? edit : undefined;
    const activeDraft = activeEdit?.draft ?? (inThread ? threadDraft : draft);
    if (!online || busy || !post) return;
    const seconds = secondsRemaining(retryUntil.current);
    if (!activeEdit && seconds > 0) {
      setError(t("slowDown", { seconds }));
      return;
    }
    const payload = chatDraftPayload(activeDraft), parent_id = inThread ? thread ?? null : null;
    const key = `${channel.id}:${parent_id ?? ""}`, serialized = JSON.stringify({ ...payload, parent_id });
    const previous = retryIds.current.get(key);
    const client_id = previous?.request === serialized ? previous.id : crypto.randomUUID();
    if (!activeEdit) {
      retryIds.current.set(key, { request: serialized, id: client_id });
      setPending({ id: client_id, text: activeDraft.text, thread: parent_id ?? undefined });
    }
    setBusy(true);
    setError("");
    try {
      const response = await (activeEdit
        ? chatRequest(`${base}/messages/${activeEdit.message.id}`, "PATCH", payload)
        : chatRequest(`${endpoint}/messages`, "POST", { ...payload, parent_id, client_id }));
      if (!response.ok) return reportError(response);
      const result: { message: ChatMessage } = await response.json();
      setMessages(current => mergeChatMessages(current, [result.message]));
      if (activeEdit) setEdit(undefined);
      else {
        retryIds.current.delete(key);
        if (inThread) setThreadDraft(emptyChatDraft);
        else setDraft(emptyChatDraft);
      }
      refresh();
    } catch { setError(t("sendFailed")); }
    finally { setBusy(false); setPending(undefined); }
  }

  async function mutate(message: ChatMessage, action: ChatAction | "reaction", emoji?: string) {
    setError("");
    const endpoint = `${base}/messages/${message.id}`;
    try {
      const response = action === "delete" ? await chatRequest(endpoint, "DELETE")
        : action === "restore" ? await chatRequest(`${endpoint}/restore`, "POST")
        : action === "reaction" ? await chatRequest(`${endpoint}/reactions`, "POST", { emoji })
        : await chatRequest(`${endpoint}/moderate`, "POST", { action: action === "restoreRemoved" ? "restore" : action });
      if (!response.ok) { reportError(response); return false; }
      refresh();
      return true;
    } catch { setError(t("actionFailed")); return false; }
  }

  function jump(item: ChatMessage) {
    info.onOpenChange(false);
    requestAnimationFrame(() => {
      const target = document.getElementById(`message-${item.id}`);
      if (target) target.scrollIntoView({ block: "center" });
      else void openThread(item);
    });
  }

  function startEdit(item: ChatMessage) {
    const text = chatTokens(item.body ?? "", item.mentionIds).map(part => {
      const person = part.type === "mention" && item.mentions.find(member => member.id === part.id);
      return person ? `@${person.name}` : part.text;
    }).join("");
    setEdit({ message: item, draft: { text, mentions: item.mentions } });
  }

  function row(item: ChatMessage, inThread = false) {
    const role = members.find(member => member.userId === item.authorId)?.role ?? "member";
    return <MessageScrollerItem key={item.id} messageId={item.id}>
      <ChatMessageRow message={item} slug={slug} mine={item.authorId === me} post={post && online}
        mayModerate={access.moderate && (item.authorId === me || canActOn(access.role, role))}
        restore={access.restore} thread={inThread} onReply={opener => { threadOpener.current = opener; void openThread(item); }} onEdit={() => startEdit(item)}
        onAction={action => action === "delete" || action === "remove" ? setConfirm({ message: item, action }) : void mutate(item, action)}
        onReact={emoji => void mutate(item, "reaction", emoji)}
        onProfile={message => {
          profileReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          const person = members.find(entry => entry.userId === message.authorId);
          setProfile({ name: person?.name ?? message.authorName ?? t("formerMember"), role: person?.role, joinedAt: person?.joinedAt });
        }} />
    </MessageScrollerItem>;
  }

  function composer(inThread: boolean) {
    const editingHere = edit && (inThread ? threadMessages.some(item => item.id === edit.message.id) : !edit.message.parentId);
    const current = editingHere ? edit.draft : inThread ? threadDraft : draft;
    return <ChatComposer members={allowedMentions} draft={current} busy={busy} blocked={!post || !online}
      mode={editingHere ? "edit" : inThread ? "reply" : "send"} onCancel={editingHere ? () => setEdit(undefined) : undefined}
      onSend={() => void send(inThread)} onChange={next => {
        if (editingHere) setEdit({ ...edit, draft: next });
        else if (inThread) setThreadDraft(next);
        else setDraft(next);
      }} />;
  }

  if (denied) return <Alert className="m-3 w-auto"><AlertDescription>{t(denied === 401 ? "signIn" : "unavailable")}</AlertDescription></Alert>;
  const inlineError = error && <Alert role="alert" variant="destructive" className="mx-3 my-1 w-auto"><AlertDescription>{error}</AlertDescription></Alert>;
  const optimistic = (parent?: string) => pending && pending.thread === parent && !messages.some(item => item.clientId === pending.id) && (
    <MessageScrollerItem messageId={pending.id}><Bubble align="end" variant="tinted"><BubbleContent>{pending.text}</BubbleContent>
      <span className="self-end text-xs text-muted-foreground">{t("sending")}</span></Bubble></MessageScrollerItem>
  );

  return <>
    {displayPins.length > 0 && <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b px-3"
      aria-label={t("pinned")} role="region"><Pin className="size-4 shrink-0" aria-hidden="true" />
      {displayPins.map(item => <Button key={item.id} className="min-h-11 max-w-48 shrink-0" variant="ghost"
        onClick={event => { threadOpener.current = event.currentTarget; void openThread(item); }}><span className="truncate">{item.body}</span></Button>)}
    </div>}
    <MessageList label={t("messagesIn", { channel: channel.name })}
      onLatest={<><ReadState seq={latestLoaded?.seq} enabled={online && focused && caughtUp && !thread} endpoint={`${endpoint}/read`} onRead={onRead} />
        <LiveMessageNotice latest={announcement} enabled={caughtUp} /></>}>
      {history?.more && <Button variant="outline" className="min-h-11 self-center" disabled={paging || !online} onClick={() => void earlier()}>{t("older")}</Button>}
      {!history ? <p className="text-sm text-muted-foreground" role="status">{t("loading")}</p>
        : !visible.length && <p className="text-sm text-muted-foreground">{t("emptyMessages")}</p>}
      {visible.map(item => row(item))}
      {optimistic()}
    </MessageList>
    {!thread && inlineError}
    {post ? composer(false) : <p className="shrink-0 px-4 py-3 text-sm text-muted-foreground">{t(access.muted ? "mutedPosting" : "hostsOnly")}</p>}
    <Sheet open={!!thread} onOpenChange={open => { if (!open) { threadRequest.current++; setThread(undefined); if (edit?.message.parentId) setEdit(undefined); } }}>
      <SheetContent side="right" className="flex h-dvh w-full min-w-0 flex-col gap-0 sm:max-w-lg"
        onCloseAutoFocus={event => {
          if (threadOpener.current?.isConnected) { event.preventDefault(); threadOpener.current.focus(); }
        }}>
        <SheetHeader className="shrink-0 border-b"><SheetTitle>{t("thread")}</SheetTitle></SheetHeader>
        <MessageList key={thread} label={t("threadReplies")} onLatest={<ReadState seq={threadMessages.at(-1)?.seq}
          enabled={!!thread && online && focused && caughtUp} endpoint={`${endpoint}/read`} onRead={onRead} />}>
          {replies?.more && <Button className="min-h-11 self-center" variant="outline" disabled={!online}
            onClick={() => { const root = threadMessages.find(item => item.id === thread); if (root) void openThread(root, replies.before); }}>{t("olderReplies")}</Button>}
          {threadMessages.map(item => row(item, true))}
          {optimistic(thread)}
        </MessageList>
        {thread && inlineError}
        {post && threadMessages.some(item => item.id === thread && !item.deletedAt && !item.heldAt) && composer(true)}
      </SheetContent>
    </Sheet>
    <ChannelInfo returnFocus={info.returnFocus} open={info.open} onOpenChange={info.onOpenChange} channel={channel} slug={slug} members={members} pins={displayPins.length ? displayPins : pins}
      messages={messages} onProfile={person => { profileReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setProfile({ name: person.name, role: person.role, joinedAt: person.joinedAt }); }} setting={info.setting} onMute={info.onMute} onJump={jump} onEdit={info.onEdit} />
    <MemberProfileSheet person={profile} onClose={() => setProfile(undefined)} returnFocus={profileReturn} />
    <ConfirmDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(undefined); }}
      title={t(confirm?.action === "remove" ? "remove" : "deleteMessage")} description={t("deleteDescription")}
      cancelLabel={t("cancel")} confirmLabel={t(confirm?.action === "remove" ? "remove" : "deleteMessage")}
      onConfirm={async () => { if (confirm && !await mutate(confirm.message, confirm.action)) return t("actionFailed"); }} />
  </>;
}
