/** Layout and behaviour modelled on bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chats-view.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";

import { useRef, useState } from "react";
import { ArrowLeft, MoreVertical, Plus, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePolling } from "@/hooks/use-polling";
import { dmName, dmUnreadTotal, sortDmList, type DmConversation, type DmList as DmListData } from "@/lib/dm-view";
import type { DirectoryMember } from "@/server/community-forum";
import { cn } from "@/lib/utils";
import { emptyChatDraft, type ChatDraft } from "./chat-composer";
import { ChatHeader } from "./chat-header";
import { ChatViewTabs } from "./chat-view-tabs";
import { chatRequest, useOnline, useWindowFocused } from "./message-list";
import { DmList } from "./dm-list";
import DmNewMessageDialog from "./dm-new-message-dialog";
import { DmPane } from "./dm-pane";
import { MemberProfileSheet, type ProfilePerson } from "./member-profile-sheet";

/** Private messages inside the chat area: the conversation list beside the open conversation (one pane at a time on phones). */
export function DmLayout({ slug, me, initial, initialConversation, members, host }: {
  slug: string;
  me: string;
  initial: DmListData;
  initialConversation?: string;
  members: DirectoryMember[];
  /** Owners and admins can always start a conversation; members only while the community allows it. */
  host: boolean;
}) {
  const t = useTranslations("CommunityDm");
  const base = `/api/communities/${slug}/chat/dms`;
  const [data, setData] = useState(initial);
  const [selected, setSelected] = useState(initialConversation);
  const [showMobilePane, setShowMobilePane] = useState(!!initialConversation);
  const [stopped, setStopped] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [profile, setProfile] = useState<ProfilePerson>();
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const listHeading = useRef<HTMLHeadingElement>(null);
  const paneHeading = useRef<HTMLHeadingElement>(null);
  const nameButton = useRef<HTMLButtonElement>(null);
  const tablet = useMediaQuery("(min-width: 768px)");
  const online = useOnline();
  const focused = useWindowFocused();
  const unreadMessages = dmUnreadTotal(data.items);
  const sorted = sortDmList(data.items);
  const conversation = selected ? sorted.find(item => item.id === selected) : undefined;
  const blockedIds = new Set(data.blockedUserIds);
  // Only owners and admins may always start; the community setting decides for everyone else. Neither depends on the other person.
  const canStart = host || data.policy === "members";

  async function loadList(signal?: AbortSignal) {
    const response = await fetch(base, { signal, cache: "no-store" });
    if (response.ok) {
      const result: DmListData & { outcome: string } = await response.json();
      if (!signal?.aborted && result.outcome === "ok") setData(result);
    }
    return response;
  }
  const refreshList = usePolling({ resource: base, mode: "rail", poll: signal => loadList(signal), onStop: setStopped });

  function select(id: string) {
    setSelected(id);
    setShowMobilePane(true);
    setError("");
    if (!tablet) requestAnimationFrame(() => paneHeading.current?.focus());
  }
  function backToList() {
    setShowMobilePane(false);
    requestAnimationFrame(() => listHeading.current?.focus());
  }

  async function act(path: string, method: string, body: unknown, apply?: (list: DmListData) => DmListData) {
    setError("");
    try {
      const response = await chatRequest(`${base}${path}`, method, body);
      if (!response.ok) { setError(t("actionFailed")); return false; }
      if (apply) setData(apply);
      await loadList();
      return true;
    } catch { setError(t("actionFailed")); return false; }
  }
  const mute = (item: DmConversation, muted: boolean) => void act(`/${item.id}/mute`, "POST", { muted },
    list => ({ ...list, items: list.items.map(row => row.id === item.id ? { ...row, muted } : row) }));
  const hide = async (item: DmConversation) => {
    if (await act(`/${item.id}/hide`, "POST", { hidden: true }, list => ({ ...list, items: list.items.filter(row => row.id !== item.id) })) && selected === item.id) {
      setSelected(undefined);
      setShowMobilePane(false);
    }
  };
  const unblock = (item: DmConversation) => void act(`/${item.id}/unblock`, "POST", {},
    list => ({ ...list, blockedUserIds: list.blockedUserIds.filter(id => id !== item.otherId) }));

  if (stopped) return <Alert className="m-3 w-auto"><AlertDescription>{t(stopped === 401 ? "signIn" : "notAvailable")}</AlertDescription></Alert>;

  const name = conversation ? dmName(conversation, t("formerMember")) : "";
  const person = conversation?.otherId ? members.find(entry => entry.userId === conversation.otherId) : undefined;
  const blocked = !!conversation?.otherId && blockedIds.has(conversation.otherId);
  const newButton = canStart && <Button variant="outline" size="icon" className="size-11 shrink-0 rounded-full" onClick={() => setComposeOpen(true)} aria-label={t("newMessage")}><Plus aria-hidden="true" /></Button>;
  return <div className="flex h-dvh min-h-64 min-w-0 overflow-hidden bg-background pt-[env(safe-area-inset-top)] md:h-[calc(100dvh-3.5rem)] md:pt-0">
    <section className={cn("min-h-0 w-full min-w-0 flex-col border-r md:flex md:w-80 md:shrink-0 lg:w-96", showMobilePane ? "hidden" : "flex")}>
      <div className="flex min-h-16 shrink-0 items-center gap-2 px-4">
        <Button asChild variant="ghost" size="icon" className="-ms-2 size-11 md:hidden"><Link href={`/communities/${slug}`} prefetch={false} aria-label={t("backToCommunity")}><ArrowLeft aria-hidden="true" /></Link></Button>
        <h2 ref={listHeading} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold outline-none">{t("messages")}</h2>
        {newButton}
      </div>
      <ChatViewTabs slug={slug} current="messages" unreadMessages={unreadMessages} />
      {error && !conversation && <Alert role="alert" variant="destructive" className="mx-4 mb-2 w-auto"><AlertDescription>{error}</AlertDescription></Alert>}
      {sorted.length ? <DmList chats={sorted} current={conversation?.id} blockedIds={blockedIds} onSelect={select} actions={{ onMute: mute, onHide: item => void hide(item) }} />
        : <p className="px-6 pt-2 text-sm text-muted-foreground">{t(canStart ? "none" : "noneOff")}</p>}
    </section>
    <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", showMobilePane ? "flex" : "hidden")}>
      {conversation ? <>
        <ChatHeader person={name} backLabel={t("backToMessages")} onBack={backToList} onInfo={() => setProfile({ name, role: person?.role, joinedAt: person?.joinedAt })}
          headingRef={paneHeading} nameRef={nameButton} listToggle={null}>
          <Button variant="ghost" size="icon" className="size-11" aria-pressed={conversation.muted} aria-label={t(conversation.muted ? "unmute" : "mute")}
            onClick={() => mute(conversation, !conversation.muted)}>{conversation.muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="size-11" aria-label={t("conversationMenu")}><MoreVertical aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="min-h-11" onSelect={() => setProfile({ name, role: person?.role, joinedAt: person?.joinedAt })}>{t("viewProfile")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" onSelect={() => void hide(conversation)}>{t("hide")}</DropdownMenuItem>
              {conversation.otherId && (blocked
                ? <DropdownMenuItem className="min-h-11" onSelect={() => unblock(conversation)}>{t("unblock")}</DropdownMenuItem>
                : <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={() => setConfirmBlock(true)}>{t("block")}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </ChatHeader>
        {!online && <Alert className="m-2 w-auto"><AlertDescription>{t("offline")}</AlertDescription></Alert>}
        {error && <Alert role="alert" variant="destructive" className="m-2 w-auto"><AlertDescription>{error}</AlertDescription></Alert>}
        <DmPane key={conversation.id} slug={slug} me={me} conversation={conversation} policy={data.policy} blocked={blocked} online={online} focused={focused}
          draft={drafts[conversation.id] ?? emptyChatDraft} setDraft={draft => setDrafts(current => ({ ...current, [conversation.id]: draft }))}
          onRead={refreshList} onUnblock={() => unblock(conversation)}
          afterReport={conversation.otherId && !blocked ? close => <Button variant="outline" className="min-h-11" onClick={() => { close(); setConfirmBlock(true); }}>{t("blockThisPerson")}</Button> : undefined} />
      </> : <div className="flex flex-1 items-center justify-center p-6">
        <p role="status" className="text-center text-sm text-muted-foreground">{t(selected ? "notAvailable" : "pick")}</p></div>}
    </section>
    <DmNewMessageDialog open={composeOpen} onOpenChange={setComposeOpen} slug={slug}
      onStarted={id => { void loadList().then(() => select(id)); }} />
    <MemberProfileSheet person={profile} onClose={() => setProfile(undefined)} returnFocus={nameButton} />
    <ConfirmDialog open={confirmBlock} onOpenChange={setConfirmBlock} tone="destructive" title={t("blockTitle", { name })} description={t("blockDescription")}
      cancelLabel={t("cancel")} confirmLabel={t("block")}
      onConfirm={async () => { if (conversation && !await act(`/${conversation.id}/block`, "POST", {}, list => ({ ...list, blockedUserIds: [...new Set([...list.blockedUserIds, conversation.otherId ?? ""])].filter(Boolean) }))) return t("actionFailed"); }} />
  </div>;
}
