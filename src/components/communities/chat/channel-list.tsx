/** Derived from Shadcn UI Kit item chat-ui4 (premium), supplied and approved 2026-11-17. */
"use client";

import { Hash, Lock, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatChannel } from "@/lib/chat-view";

export function ChannelList({ channels, current, onSelect }: {
  channels: ChatChannel[];
  current?: string;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("CommunityChat");
  return <nav aria-label={t("channels")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <ul className="flex flex-col gap-1 px-2 pb-3">
      {channels.map(channel => {
        const active = channel.id === current;
        const unread = channel.mute !== "all" && channel.unread > 0;
        const count = channel.mute === "none" && unread;
        const Icon = channel.accessMode === "all" ? Hash : Lock;
        return <li key={channel.id}>
          <Button variant="ghost" onClick={() => onSelect(channel.id)} aria-current={active ? "page" : undefined}
            className={cn("h-auto min-h-11 w-full flex-col items-stretch gap-1.5 rounded-xl border border-transparent px-3 py-2.5 text-left font-normal whitespace-normal",
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
        </li>;
      })}
    </ul>
  </nav>;
}
