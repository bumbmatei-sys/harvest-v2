"use client";
import { createContext, useContext, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarDays, GraduationCap, Info, LayoutList, MessageCircle, MessagesSquare, Package, ShieldCheck, Users, Wheat } from "lucide-react";
import { NotificationBell } from "@/components/communities/notification-bell";
import type { NotificationPrefs } from "@/lib/notifications";
import { usePolling } from "@/hooks/use-polling";
import { chatUnreadTotal, type ChatChannel } from "@/lib/chat-view";
import { cn } from "@/lib/utils";

const ChatUnreadContext = createContext<(count: number) => void>(() => {});
export function useChatUnreadBadge() { return useContext(ChatUnreadContext); }

/**
 * Member layout for a community (C09). Design follows the Eden reference (icon rail with Chat, Forum, Events, Products,
 * Members, Messages); style is Studio Admin through the shared tokens. On phones the rail becomes a bottom bar.
 * `chatView` makes the chat full screen on phones, like a messaging app: no header and no bottom bar (the chat supplies its own back control).
 */
export function CommunityShell({ slug, name, chat = false, events = false, shelf = false, chatView = false, initialChatUnread = 0, moderation = null, notifications, children }: { slug: string; name: string; chat?: boolean; events?: boolean; /** C13/C16: the Classroom and Products tabs (free catalogue gate). */ shelf?: boolean; chatView?: boolean; initialChatUnread?: number; moderation?: number | null; notifications?: { unread: number; prefs: NotificationPrefs }; children: React.ReactNode }) {
  const t = useTranslations("CommunityShell"), pathname = usePathname(), base = `/communities/${slug}`;
  const [badge, setBadge] = useState(initialChatUnread);
  const etag = useRef<{ slug: string; tag: string | null }>(null);
  usePolling({
    resource: chat && !chatView ? `/api${base}/chat/state` : null,
    mode: "rail",
    poll: async signal => {
      const current = etag.current?.slug === slug ? etag.current.tag : null;
      const response = await fetch(`/api${base}/chat/state`, { signal, cache: "no-store", headers: current ? { "If-None-Match": current } : undefined });
      if (response.ok) {
        const data: { channels: ChatChannel[] } = await response.json();
        if (!signal.aborted) { etag.current = { slug, tag: response.headers.get("ETag") }; setBadge(chatUnreadTotal(data.channels)); }
      }
      return response;
    },
    onStop: () => setBadge(0),
  });
  type Item = { id: string; icon: typeof Info; soon?: true; href?: string; match?: string[]; badge?: number };
  const items: Item[] = [
    ...(chat ? [{ id: "chat", icon: MessagesSquare, href: `${base}/chat`, match: [`${base}/chat`], badge }] : []), { id: "forum", icon: LayoutList, href: `${base}/forum`, match: [`${base}/forum`, `${base}/posts`] },
    ...(shelf ? [{ id: "classroom", icon: GraduationCap, href: `${base}/classroom`, match: [`${base}/classroom`] }] : []),
    ...(events ? [{ id: "events", icon: CalendarDays, href: `${base}/events`, match: [`${base}/events`] }] : [{ id: "events", icon: CalendarDays, soon: true as const }]),
    shelf ? { id: "products", icon: Package, href: `${base}/products`, match: [`${base}/products`] } : { id: "products", icon: Package, soon: true as const },
    { id: "members", icon: Users, href: `${base}/members`, match: [`${base}/members`] }, chat ? { id: "messages", icon: MessageCircle, href: `${base}/messages`, match: [`${base}/messages`] } : { id: "messages", icon: MessageCircle, soon: true as const },
    { id: "about", icon: Info, href: `${base}/about`, match: [`${base}/about`] },
    // C12a: hosts only, with open reports plus held items as a badge.
    ...(moderation === null ? [] : [{ id: "moderation", icon: ShieldCheck, href: `${base}/moderation`, match: [`${base}/moderation`], badge: moderation }]),
  ];
  const entry = (item: Item, compact: boolean) => {
    const Icon = item.icon, label = t(`items.${item.id}` as "items.forum");
    const inner = <><span className="relative"><Icon className="size-5" aria-hidden="true" />
      {item.badge ? <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground" aria-hidden="true">{item.badge > 99 ? t("manyItems") : item.badge}</span> : null}</span>
      <span className={cn("text-[11px] leading-tight", compact && "sr-only sm:not-sr-only")}>{label}</span>
      {item.badge ? <span className="sr-only">{t(item.id === "chat" ? "unread" : "toReview", { count: item.badge })}</span> : null}</>;
    const classes = "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-center";
    if (item.soon || !item.href || !item.match) return <span key={item.id} aria-disabled="true" title={t("comingSoon")} className={cn(classes, "cursor-not-allowed text-muted-foreground/60")}>
      {inner}<span className="sr-only">{t("comingSoon")}</span></span>;
    const active = item.match.some((m) => pathname.startsWith(m));
    return <Link key={item.id} href={item.href} aria-current={active ? "page" : undefined} prefetch={false}
      className={cn(classes, active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{inner}</Link>;
  };
  return <div className="flex min-h-dvh bg-background">
    <a href="#community-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skip")}</a>
    <nav aria-label={t("navigation")} className="sticky top-0 hidden h-dvh w-20 shrink-0 flex-col items-center gap-1 border-r p-2 md:flex">
      <Link href="/account/communities" prefetch={false} className="mb-2 flex size-11 items-center justify-center rounded-md hover:bg-muted" aria-label={t("myCommunities")}>
        <Wheat className="size-6" aria-hidden="true" /></Link>
      {items.map((item) => entry(item, false))}
    </nav>
    <div className={cn("flex min-w-0 flex-1 flex-col md:pb-0", !chatView && "pb-20")}>
      <header className={cn("flex min-h-14 items-center gap-3 border-b px-4", chatView && "hidden md:flex")}><h1 className="min-w-0 flex-1 truncate text-base font-semibold">{name}</h1>
        {notifications && <NotificationBell slug={slug} unread={notifications.unread} prefs={notifications.prefs} />}</header>
      <main id="community-main" tabIndex={-1} className="min-w-0 flex-1 outline-none"><ChatUnreadContext.Provider value={setBadge}>{children}</ChatUnreadContext.Provider></main>
    </div>
    {/* Every entry keeps a 44px target; on the narrowest phones the bar scrolls sideways instead of shrinking them. */}
    {!chatView && <nav aria-label={t("navigation")} className="fixed inset-x-0 bottom-0 z-40 grid overflow-x-auto border-t bg-background px-1 py-1 md:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(2.75rem, 1fr))` }}>
      {items.map((item) => entry(item, true))}
    </nav>}
  </div>;
}
