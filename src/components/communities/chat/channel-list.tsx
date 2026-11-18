/** Composed from Harvest shared components. The Shadcn UI Kit chat blocks were a layout reference only and no kit code is copied here. Exception to the use-kit rule approved by the founder on 18 November 2026 for this screen; the next screens (DMs, profile, events) adopt the real kit blocks from the start. See docs/ui-sources.md. */
"use client";

import { ArrowDown, ArrowUp, Archive, Hash, Lock, MoreVertical, Pencil, Plus, Trash2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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

export function ChannelList({ channels, current, onSelect, manage }: {
  channels: ChatChannel[];
  current?: string;
  onSelect: (id: string) => void;
  manage?: ChannelManage;
}) {
  const t = useTranslations("CommunityChat");
  return <nav aria-label={t("channels")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {manage && <div className="px-3 pb-2">
      <Button variant="outline" className="min-h-11 w-full" disabled={manage.busy || !manage.canCreate} onClick={manage.onNew}><Plus aria-hidden="true" />{t("newChannel")}</Button>
    </div>}
    <ul className="flex flex-col gap-1 px-2 pb-3">
      {channels.map(channel => {
        const active = channel.id === current;
        const unread = channel.mute !== "all" && channel.unread > 0;
        const count = channel.mute === "none" && unread;
        const Icon = channel.accessMode === "all" ? Hash : Lock;
        const index = manage?.order.indexOf(channel.id) ?? -1;
        return <li key={channel.id} className={manage ? "flex items-start gap-1" : undefined}>
          <Button variant="ghost" onClick={() => onSelect(channel.id)} aria-current={active ? "page" : undefined}
            className={cn("h-auto min-h-11 w-full min-w-0 flex-col items-stretch gap-1.5 rounded-xl border border-transparent px-3 py-2.5 text-left font-normal whitespace-normal",
              active && "border-border bg-muted/60 hover:bg-muted/60")}>
            <span className="flex min-w-0 items-center gap-2">
              {channel.emoji ? <span aria-hidden="true">{channel.emoji}</span> : <Icon className="text-muted-foreground" aria-hidden="true" />}
              <span className={cn("min-w-0 flex-1 truncate text-sm", unread && "font-semibold")}>{channel.name}</span>
              {channel.mute === "all" && <VolumeX className="text-muted-foreground" aria-label={t("mutes.all")} />}
              {unread && !count && <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={t("unread")} />}
              {count && <Badge className="tabular-nums" aria-label={t("unreadCount", { count: channel.unread })}>{channel.unread > 99 ? t("many") : channel.unread}</Badge>}
              {channel.mentions > 0 && channel.mute !== "all" && <Badge variant="outline" aria-label={t("mentionsCount", { count: channel.mentions })}>{t("mentionBadge", { count: channel.mentions > 99 ? t("many") : channel.mentions })}</Badge>}
            </span>
            {channel.description && <span className="truncate text-sm text-muted-foreground">{channel.description}</span>}
          </Button>
          {manage && <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={t("channelOptions", { name: channel.name })}><MoreVertical aria-hidden="true" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="min-h-11" disabled={manage.busy} onSelect={() => manage.onEdit(channel.id)}><Pencil aria-hidden="true" />{t("editChannel")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" disabled={manage.busy || index < 1} onSelect={() => manage.onMove(channel.id, -1)}><ArrowUp aria-hidden="true" />{t("moveUp", { name: channel.name })}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" disabled={manage.busy || index === manage.order.length - 1} onSelect={() => manage.onMove(channel.id, 1)}><ArrowDown aria-hidden="true" />{t("moveDown", { name: channel.name })}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="min-h-11" disabled={manage.busy} onSelect={() => manage.onArchive(channel.id)}><Archive aria-hidden="true" />{t("archive")}</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11" variant="destructive" disabled={manage.busy} onSelect={() => manage.onDelete(channel.id)}><Trash2 aria-hidden="true" />{t("deleteChannel")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>}
        </li>;
      })}
    </ul>
  </nav>;
}
