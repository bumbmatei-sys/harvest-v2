/** Derived from bumbmatei-sys/chat-app (Shadcn UI Kit, premium, founder-supplied 19 Nov 2026): app/(auth)/chats/components/chat-list.tsx, chat-list-item.tsx and chat-list-item-dropdown.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Archive, Ellipsis, Hash, Lock, Pencil, Search, Trash2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import UserAvatar from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatChannel } from "@/lib/chat-view";

/** Channel administration, offered only to roles the server allows (chat:manage_channels). Every action is authorized again by the server. */
export type ChannelManage = {
  busy: boolean;
  canCreate: boolean;
  onNew: () => void;
  onEdit: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  /** Position among the channels in stored order, used to disable the first up and the last down. */
  order: string[];
};

function ChannelMark({ channel }: { channel: ChatChannel }) {
  const Icon = channel.accessMode === "all" ? Hash : Lock;
  return channel.emoji ? <UserAvatar name={channel.name} emoji={channel.emoji} className="size-12" />
    : <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><Icon className="size-5" aria-hidden="true" /></span>;
}

export function ChannelList({ channels, current, onSelect, manage }: {
  channels: ChatChannel[];
  current?: string;
  onSelect: (id: string) => void;
  manage?: ChannelManage;
}) {
  const t = useTranslations("CommunityChat");
  const [query, setQuery] = useState("");
  const shown = channels.filter(channel => channel.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <nav aria-label={t("channels")} className="flex min-h-0 flex-1 flex-col">
    <div className="relative flex shrink-0 items-center px-4 pb-3">
      <Search className="absolute start-7 size-4 text-muted-foreground" aria-hidden="true" />
      <Input type="search" className="min-h-11 ps-9" aria-label={t("searchChannels")} placeholder={t("searchChannels")} value={query} onChange={event => setQuery(event.target.value)} />
    </div>
    <ScrollArea className="min-h-0 w-full min-w-0 flex-1" viewportClassName="overscroll-contain">
      <ul className="block min-w-0 divide-y">
        {shown.length ? shown.map(channel => {
          const active = channel.id === current;
          const unread = channel.mute !== "all" && channel.unread > 0;
          const count = channel.mute === "none" && unread;
          const index = manage?.order.indexOf(channel.id) ?? -1;
          return <li key={channel.id} className={cn("flex min-w-0 items-center gap-1 pe-2 hover:bg-muted", active && "bg-muted")}>
            <Button variant="ghost" onClick={() => onSelect(channel.id)} aria-current={active ? "page" : undefined}
              className="h-auto min-h-16 min-w-0 flex-1 justify-start gap-3 rounded-none px-4 py-3 text-left font-normal whitespace-normal hover:bg-transparent">
              <ChannelMark channel={channel} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className={cn("min-w-0 flex-1 truncate font-medium", unread && "font-semibold")}>{channel.name}</span>
                  {channel.mute === "all" && <VolumeX className="size-4 shrink-0 text-muted-foreground" aria-label={t("mutes.all")} />}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{channel.description}</span>
                  {unread && !count && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label={t("unread")} />}
                  {count && <Badge className="min-w-5 justify-center rounded-full tabular-nums" aria-label={t("unreadCount", { count: channel.unread })}>{channel.unread > 99 ? t("many") : channel.unread}</Badge>}
                  {channel.mentions > 0 && channel.mute !== "all" && <Badge variant="outline" aria-label={t("mentionsCount", { count: channel.mentions })}>{t("mentionBadge", { count: channel.mentions > 99 ? t("many") : channel.mentions })}</Badge>}
                </span>
              </span>
            </Button>
            {manage && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 shrink-0 rounded-full" aria-label={t("channelOptions", { name: channel.name })}><Ellipsis aria-hidden="true" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem className="min-h-11" disabled={manage.busy} onSelect={() => manage.onEdit(channel.id)}><Pencil aria-hidden="true" />{t("editChannel")}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={manage.busy || index < 1} onSelect={() => manage.onMove(channel.id, -1)}><ArrowUp aria-hidden="true" />{t("moveUp", { name: channel.name })}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" disabled={manage.busy || index === manage.order.length - 1} onSelect={() => manage.onMove(channel.id, 1)}><ArrowDown aria-hidden="true" />{t("moveDown", { name: channel.name })}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="min-h-11" disabled={manage.busy} onSelect={() => manage.onArchive(channel.id)}><Archive aria-hidden="true" />{t("archive")}</DropdownMenuItem>
                <DropdownMenuItem className="min-h-11" variant="destructive" disabled={manage.busy} onSelect={() => manage.onDelete(channel.id)}><Trash2 aria-hidden="true" />{t("deleteChannel")}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>}
          </li>;
        }) : <li className="mt-4 text-center text-sm text-muted-foreground">{t("noChannelsFound")}</li>}
      </ul>
    </ScrollArea>
  </nav>;
}
