"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Switches between the channel list and the private message list inside the chat area. Both are full pages so each loads only its own data. */
export function ChatViewTabs({ slug, current, unreadMessages }: { slug: string; current: "channels" | "messages"; unreadMessages: number }) {
  const t = useTranslations("CommunityDm");
  const items = [
    { id: "channels", href: `/communities/${slug}/chat`, label: t("channelsTab") },
    { id: "messages", href: `/communities/${slug}/messages`, label: t("messagesTab"), count: unreadMessages },
  ] as const;
  return <nav aria-label={t("chatViews")} className="mx-4 mb-2 grid shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted p-1">
    {items.map(item => <Link key={item.id} href={item.href} prefetch={false} aria-current={current === item.id ? "page" : undefined}
      className={cn("flex min-h-11 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        current === item.id ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}>
      {item.label}
      {"count" in item && item.count > 0 && <Badge className="min-w-5 justify-center rounded-full tabular-nums" aria-label={t("unreadConversations", { count: item.count })}>{item.count > 99 ? t("many") : item.count}</Badge>}
    </Link>)}
  </nav>;
}
