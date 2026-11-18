/** Composed from Harvest shared components. The Shadcn UI Kit chat blocks were a layout reference only and no kit code is copied here. Exception to the use-kit rule approved by the founder on 18 November 2026 for this screen; the next screens (DMs, profile, events) adopt the real kit blocks from the start. See docs/ui-sources.md. */
"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Hash, PanelLeft, Volume2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePolling } from "@/hooks/use-polling";
import { channelInput, channelMutes } from "@/lib/chat";
import type { ChatAccess, ChatChannel, ChatChannelSetting } from "@/lib/chat-view";
import type { DirectoryMember } from "@/server/community-forum";
import { cn } from "@/lib/utils";
import { ChannelList, type ChannelManage } from "./channel-list";
import { ChannelSheet, chatChannelCall, newChannel } from "./channel-sheet";
import { emptyChatDraft, type ChatDraft } from "./chat-composer";
import { MessagePane } from "./message-pane";

const onlineEvents = (callback: () => void) => {
  window.addEventListener("offline", callback);
  window.addEventListener("online", callback);
  return () => {
    window.removeEventListener("offline", callback);
    window.removeEventListener("online", callback);
  };
};

const focusEvents = (callback: () => void) => {
  window.addEventListener("focus", callback);
  window.addEventListener("blur", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener("focus", callback);
    window.removeEventListener("blur", callback);
    document.removeEventListener("visibilitychange", callback);
  };
};

const fromSetting = (setting: ChatChannelSetting, previous?: ChatChannel): ChatChannel => ({
  id: setting.id, name: setting.name, emoji: setting.emoji, description: setting.description, position: setting.position, archived: setting.archived,
  minRole: setting.minRole, posting: setting.posting, accessMode: setting.accessMode,
  latestRev: previous?.latestRev ?? "0", mute: previous?.mute ?? "none", unread: previous?.unread ?? 0, mentions: previous?.mentions ?? 0,
});
const inOrder = (list: ChatChannelSetting[]) => list.filter(item => !item.archived).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

export function ChatLayout({ slug, me, access, initial, initialChannel, members, manage: initialManage }: {
  slug: string;
  me: string;
  access: ChatAccess;
  initial: ChatChannel[];
  initialChannel?: string;
  members: DirectoryMember[];
  /** Channel settings, present only when the server allows this member to manage channels. */
  manage?: ChatChannelSetting[];
}) {
  const t = useTranslations("CommunityChat");
  const base = `/api/communities/${slug}/chat`;
  const [channels, setChannels] = useState(initial);
  const [selected, setSelected] = useState(initialChannel);
  const [showMobileThread, setShowMobileThread] = useState(initial.some(channel => channel.id === initialChannel && !channel.archived));
  const [listOpen, setListOpen] = useState(false);
  const [stopped, setStopped] = useState<number | null>(null);
  const [muteError, setMuteError] = useState("");
  const [settings, setSettings] = useState(initialManage);
  const [sheet, setSheet] = useState<ChatChannelSetting>();
  const [confirm, setConfirm] = useState<{ id: string; kind: "archive" | "delete" }>();
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const retryIds = useRef(new Map<string, { request: string; id: string }>());
  const tag = useRef<string | null>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const paneHeading = useRef<HTMLHeadingElement>(null);
  const tablet = useMediaQuery("(min-width: 768px)");
  const online = useSyncExternalStore(onlineEvents, () => navigator.onLine, () => true);

  const refreshRail = usePolling({
    resource: base,
    mode: "rail",
    poll: async signal => {
      const response = await fetch(`${base}/state`, { signal, cache: "no-store", headers: tag.current ? { "If-None-Match": tag.current } : undefined });
      if (response.ok) {
        const result: { channels: ChatChannel[] } = await response.json();
        if (!signal.aborted) {
          tag.current = response.headers.get("ETag");
          setChannels(result.channels);
        }
      }
      return response;
    },
    onStop: setStopped,
  });

  const focused = useSyncExternalStore(focusEvents, () => document.visibilityState === "visible" && document.hasFocus(), () => false);
  const ordered = channels.filter(channel => !channel.archived).sort((a, b) => Number(a.mute === "all") - Number(b.mute === "all") || a.position - b.position || a.id.localeCompare(b.id));
  const channel = selected ? ordered.find(item => item.id === selected) : ordered[0];
  const channelId = channel?.id;

  function select(id: string) {
    setSelected(id);
    setShowMobileThread(true);
    setListOpen(false);
    setMuteError("");
    if (!tablet) requestAnimationFrame(() => paneHeading.current?.focus());
  }

  function backToChannels() {
    setShowMobileThread(false);
    requestAnimationFrame(() => listHeading.current?.focus());
  }

  async function mute(value: typeof channelMutes[number], id: string) {
    setMuteError("");
    try {
      const response = await fetch(`${base}/channels/${id}/mute`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mute: value }),
      });
      if (!response.ok) throw new Error();
      setChannels(list => list.map(item => item.id === id ? { ...item, mute: value } : item));
      refreshRail();
    } catch {
      setMuteError(t("actionFailed"));
    }
  }

  const forget = (id: string) => {
    if (selected === id || channel?.id === id) { setSelected(undefined); setShowMobileThread(false); }
  };
  const refreshAfterAdmin = () => { tag.current = null; refreshRail(); };

  /** The latest stored settings (including invite lists); other hosts may have changed them since the page loaded. */
  async function latestSettings() {
    const response = await chatChannelCall(base, "/settings", "GET");
    if (!response.ok) { setAdminError(t(response.key)); return null; }
    const list = response.result.channels;
    setSettings(list);
    return list;
  }

  function saved(entry: ChatChannelSetting) {
    setSettings(list => [...(list ?? []).filter(item => item.id !== entry.id), entry]);
    setChannels(list => [...list.filter(item => item.id !== entry.id), fromSetting(entry, list.find(item => item.id === entry.id))]);
    setSheet(undefined);
    if (entry.archived) forget(entry.id);
    refreshAfterAdmin();
  }

  async function edit(id: string) {
    if (adminBusy) return;
    setAdminBusy(true);
    setAdminError("");
    try {
      const target = (await latestSettings())?.find(item => item.id === id);
      if (target) setSheet(target);
      else if (settings) setAdminError(t("actionFailed"));
    } finally { setAdminBusy(false); }
  }

  async function move(id: string, direction: -1 | 1) {
    if (adminBusy || !settings) return;
    setAdminBusy(true);
    setAdminError("");
    try {
      const ids = inOrder(settings).map(item => item.id), at = ids.indexOf(id), other = at + direction;
      if (!ids[other]) return;
      [ids[at], ids[other]] = [ids[other], ids[at]];
      const response = await chatChannelCall(base, "/channels/reorder", "PUT", { ids });
      if (!response.ok) { setAdminError(t(response.key)); return; }
      const position = (channelId: string) => ids.indexOf(channelId) + 1;
      setSettings(list => list?.map(item => ids.includes(item.id) ? { ...item, position: position(item.id) } : item));
      setChannels(list => list.map(item => ids.includes(item.id) ? { ...item, position: position(item.id) } : item));
      refreshAfterAdmin();
    } finally { setAdminBusy(false); }
  }

  async function confirmed(): Promise<string | void> {
    if (!confirm) return;
    const { id, kind } = confirm;
    setAdminError("");
    let result;
    if (kind === "delete") result = await chatChannelCall(base, `/channels/${id}`, "DELETE");
    else {
      const target = (await latestSettings())?.find(item => item.id === id);
      const body = target && channelInput.safeParse({ ...target, id: undefined, userIds: undefined, archived: true });
      if (!target || !body?.success) return t("actionFailed");
      result = await chatChannelCall(base, `/channels/${id}`, "PUT", body.data);
    }
    if (!result.ok) return t(result.key);
    setSettings(list => list?.filter(item => item.id !== id));
    setChannels(list => list.filter(item => item.id !== id));
    forget(id);
    refreshAfterAdmin();
  }

  const manage: ChannelManage | undefined = settings && {
    busy: adminBusy, canCreate: inOrder(settings).length < 30, order: inOrder(settings).map(item => item.id),
    onNew: () => { setAdminError(""); setSheet(newChannel(Math.max(0, ...settings.map(item => item.position)) + 1)); },
    onEdit: id => void edit(id), onMove: (id, direction) => void move(id, direction),
    onArchive: id => setConfirm({ id, kind: "archive" }), onDelete: id => setConfirm({ id, kind: "delete" }),
  };

  if (stopped) return <Alert className="m-3 w-auto"><AlertDescription>{t(stopped === 401 ? "signIn" : "unavailable")}</AlertDescription></Alert>;
  const list = <ChannelList channels={ordered} current={channelId} onSelect={select} manage={manage} />;
  const mutedChannel = <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="size-11" aria-label={t("muteChannel")}><Volume2 aria-hidden="true" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      <DropdownMenuRadioGroup value={channel?.mute} onValueChange={value => { if (channelId) void mute(value as typeof channelMutes[number], channelId); }}>
        {channelMutes.map(option => <DropdownMenuRadioItem className="min-h-11" key={option} value={option}>{t(`mutes.${option}`)}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;

  const channelName = confirm && channels.find(item => item.id === confirm.id)?.name;
  // On phones the community header and bottom bar are hidden (CommunityShell chatView), so the chat fills the screen.
  return <div className="flex h-dvh min-h-64 min-w-0 overflow-hidden pt-[env(safe-area-inset-top)] md:h-[calc(100dvh-3.5rem)] md:pt-0">
    <section className={cn("min-h-0 w-full min-w-0 flex-col border-r lg:flex lg:w-80 lg:shrink-0", showMobileThread && channel ? "hidden" : "flex md:hidden")}>
      <div className="flex min-h-14 shrink-0 items-center gap-2 px-3 md:px-4">
        <Button asChild variant="ghost" size="icon" className="size-11 md:hidden"><Link href={`/communities/${slug}`} prefetch={false} aria-label={t("backToCommunity")}><ArrowLeft aria-hidden="true" /></Link></Button>
        <h2 ref={listHeading} tabIndex={-1} className="min-w-0 flex-1 truncate text-lg font-semibold outline-none">{t("channels")}</h2>
      </div>
      {adminError && !sheet && <Alert role="alert" variant="destructive" className="mx-3 mb-2 w-auto"><AlertDescription>{adminError}</AlertDescription></Alert>}
      {ordered.length || manage ? list : <p className="px-4 text-sm text-muted-foreground">{t("noChannels")}</p>}
    </section>
    <section className={cn("min-h-0 min-w-0 flex-1 flex-col md:flex", showMobileThread && channel ? "flex" : "hidden")}>
      <div className="flex min-h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
        <Button variant="ghost" size="icon" className="size-11 md:hidden" onClick={backToChannels}
          aria-label={t("backToChannels")}><ArrowLeft aria-hidden="true" /></Button>
        <Sheet open={listOpen} onOpenChange={setListOpen}>
          <SheetTrigger asChild><Button variant="ghost" size="icon" className="hidden size-11 md:inline-flex lg:hidden" aria-label={t("channels")}><PanelLeft aria-hidden="true" /></Button></SheetTrigger>
          <SheetContent side="left" className="flex min-h-0 w-[min(20rem,90vw)] flex-col">
            <SheetHeader><SheetTitle>{t("channels")}</SheetTitle></SheetHeader>
            {list}
          </SheetContent>
        </Sheet>
        {channel && <><Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 ref={paneHeading} tabIndex={-1} className="min-w-0 flex-1 truncate font-semibold outline-none">{channel.name}</h2>
          {mutedChannel}</>}
      </div>
      {!online && <Alert className="m-2 w-auto"><AlertDescription>{t("offline")}</AlertDescription></Alert>}
      {muteError && <Alert role="alert" variant="destructive" className="m-2 w-auto"><AlertDescription>{muteError}</AlertDescription></Alert>}
      {channel && (tablet || showMobileThread) ? <MessagePane key={channel.id} channel={channel} slug={slug} me={me} online={online} focused={focused} access={access}
        members={members} draft={drafts[channel.id] ?? emptyChatDraft} retryIds={retryIds}
        setDraft={draft => setDrafts(existing => ({ ...existing, [channel.id]: draft }))} onRead={refreshRail} />
        : !channel && <p className="p-4 text-sm text-muted-foreground">{t(selected ? "unavailable" : "noChannels")}</p>}
    </section>
    {sheet && settings && <ChannelSheet key={sheet.id || "new"} base={base} channel={sheet} members={members} open
      onOpenChange={open => { if (!open) setSheet(undefined); }} onSaved={entry => { saved(entry); if (!sheet.id && !entry.archived) select(entry.id); }} />}
    <ConfirmDialog open={!!confirm} onOpenChange={open => { if (!open) setConfirm(undefined); }} tone="destructive"
      title={t(confirm?.kind === "delete" ? "deleteChannel" : "archive")}
      description={channelName ? t(confirm?.kind === "delete" ? "deleteChannelDescription" : "archiveChannelDescription", { name: channelName }) : undefined}
      cancelLabel={t("cancel")} confirmLabel={t(confirm?.kind === "delete" ? "deleteChannel" : "archive")} onConfirm={confirmed} />
  </div>;
}
