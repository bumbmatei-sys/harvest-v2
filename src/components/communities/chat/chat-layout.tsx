/** Derived from Shadcn UI Kit item chat-ui10 (premium), supplied and approved 2026-11-17. */
"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Hash, PanelLeft, Volume2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMediaQuery } from "@/hooks/use-media-query";
import { usePolling } from "@/hooks/use-polling";
import { channelMutes } from "@/lib/chat";
import type { ChatAccess, ChatChannel } from "@/lib/chat-view";
import type { DirectoryMember } from "@/server/community-forum";
import { cn } from "@/lib/utils";
import { ChannelList } from "./channel-list";
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

export function ChatLayout({ slug, me, access, initial, initialChannel, members }: {
  slug: string;
  me: string;
  access: ChatAccess;
  initial: ChatChannel[];
  initialChannel?: string;
  members: DirectoryMember[];
}) {
  const t = useTranslations("CommunityChat");
  const base = `/api/communities/${slug}/chat`;
  const [channels, setChannels] = useState(initial);
  const [selected, setSelected] = useState(initialChannel);
  const [showMobileThread, setShowMobileThread] = useState(initial.some(channel => channel.id === initialChannel && !channel.archived));
  const [listOpen, setListOpen] = useState(false);
  const [stopped, setStopped] = useState<number | null>(null);
  const [muteError, setMuteError] = useState("");
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

  if (stopped) return <Alert className="m-3 w-auto"><AlertDescription>{t(stopped === 401 ? "signIn" : "unavailable")}</AlertDescription></Alert>;
  const list = <ChannelList channels={ordered} current={channelId} onSelect={select} />;
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

  return <div className="flex h-[calc(100dvh-7rem-env(safe-area-inset-bottom))] min-h-64 min-w-0 overflow-hidden md:h-[calc(100dvh-3.5rem)]">
    <section className={cn("min-h-0 w-full min-w-0 flex-col border-r lg:flex lg:w-80 lg:shrink-0", showMobileThread && channel ? "hidden" : "flex md:hidden")}>
      <h2 ref={listHeading} tabIndex={-1} className="flex min-h-14 shrink-0 items-center px-4 text-lg font-semibold outline-none">{t("channels")}</h2>
      {ordered.length ? list : <p className="px-4 text-sm text-muted-foreground">{t("noChannels")}</p>}
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
  </div>;
}
