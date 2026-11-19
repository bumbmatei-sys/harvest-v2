/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-list.tsx, app/(auth)/chats/components/chat-list-item.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useState } from "react";
import { Ellipsis, Search, VolumeX } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { dmName, type DmConversation } from "@/lib/dm-view";
import UserAvatar from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export type DmRowActions = {
  onMute: (item: DmConversation, muted: boolean) => void;
  onHide: (item: DmConversation) => void;
};

function ChatListItem({
  chat,
  active,
  blocked,
  onSelect,
  actions,
}: {
  chat: DmConversation;
  active: boolean | null;
  blocked: boolean;
  onSelect: (id: string) => void;
  actions: DmRowActions;
}) {
  const t = useTranslations("CommunityDm");
  const format = useFormatter();
  const name = dmName(chat, t("formerMember"));
  const when = chat.lastMessageAt ? new Date(chat.lastMessageAt) : null;
  const sameDay = when && when.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
  const unreadMessageCount = chat.muted ? 0 : chat.unread;

  return (
    <li
      className={cn(
        "flex items-center gap-1 pe-2 hover:bg-muted group min-w-0 relative",
        { "bg-muted": active }
      )}
    >
      <Button
        variant="ghost"
        onClick={() => onSelect(chat.id)}
        aria-current={active ? "page" : undefined}
        className="h-auto min-h-16 min-w-0 flex-1 items-center justify-start gap-4 whitespace-normal rounded-none py-4 px-6 text-left font-normal hover:bg-transparent"
      >
        <UserAvatar name={name} className="size-12" />
        <span className="grow min-w-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className="font-medium truncate">{name}</span>
            {when && (
              <time dateTime={when.toISOString()} className="text-xs text-muted-foreground shrink-0">
                {format.dateTime(when, sameDay ? { timeStyle: "short" } : { dateStyle: "medium" })}
              </time>
            )}
          </span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span className="truncate text-start text-sm text-muted-foreground">
              {blocked ? t("blockedShort") : !chat.canSend ? t("readOnlyShort") : ""}
            </span>
            {chat.muted && <VolumeX className="size-4 shrink-0 text-muted-foreground ms-auto" aria-label={t("muted")} />}
            {unreadMessageCount > 0 && (
              <Badge className="text-xs font-medium flex items-center justify-center min-w-5 shrink-0 rounded-full ms-auto tabular-nums" aria-label={t("unreadCount", { count: unreadMessageCount })}>
                {unreadMessageCount > 99 ? t("many") : unreadMessageCount}
              </Badge>
            )}
          </span>
        </span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" className="size-11 shrink-0 rounded-full" aria-label={t("conversationOptions", { name })}>
            <Ellipsis className="w-4 h-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem className="min-h-11" onSelect={() => actions.onMute(chat, !chat.muted)}>{t(chat.muted ? "unmute" : "mute")}</DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onSelect={() => actions.onHide(chat)}>{t("hide")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

export function DmList({
  chats,
  current,
  blockedIds,
  onSelect,
  actions,
}: {
  chats: DmConversation[];
  current?: string;
  blockedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  actions: DmRowActions;
}) {
  const t = useTranslations("CommunityDm");
  const [query, setQuery] = useState("");

  const filteredChats = chats.filter((chat) =>
    dmName(chat, t("formerMember"))
      .toLowerCase()
      .includes(query.trim().toLowerCase())
  );

  return (
    <nav aria-label={t("messages")} className="flex min-h-0 flex-1 flex-col">
      <div className="pb-3 px-6 relative flex items-center shrink-0">
        <Search className="absolute w-4 h-4 start-9 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          className="min-h-11 ps-9"
          aria-label={t("search")}
          placeholder={t("search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex-1 min-h-0 flex">
        <ScrollArea className="w-full min-w-0" viewportClassName="overscroll-contain">
          <ul className="block divide-y min-w-0">
            {filteredChats.length ? (
              filteredChats.map((chat) => (
                <ChatListItem
                  chat={chat}
                  key={chat.id}
                  active={chat.id === current}
                  blocked={!!chat.otherId && blockedIds.has(chat.otherId)}
                  onSelect={onSelect}
                  actions={actions}
                />
              ))
            ) : (
              <li className="text-center text-muted-foreground text-sm mt-4 px-6">
                {t(chats.length ? "noneFound" : "none")}
              </li>
            )}
          </ul>
        </ScrollArea>
      </div>
    </nav>
  );
}
