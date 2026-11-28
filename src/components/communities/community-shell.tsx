/** Derived from Shadcn UI Kit item dashboard-shell4 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Community screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import { createContext, useContext, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarDays, GraduationCap, Info, LayoutList, MessageCircle, MessagesSquare, Package, ShieldCheck, Users, Wheat, type LucideIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { NotificationBell } from "@/components/communities/notification-bell";
import type { NotificationPrefs } from "@/lib/notifications";
import { usePolling } from "@/hooks/use-polling";
import { chatUnreadTotal, type ChatChannel } from "@/lib/chat-view";
import { cn } from "@/lib/utils";

const ChatUnreadContext = createContext<(count: number) => void>(() => {});
export function useChatUnreadBadge() { return useContext(ChatUnreadContext); }

type Item = { id: string; icon: LucideIcon; soon?: true; href?: string; match?: string[]; badge?: number };

/**
 * Member layout for a community (C09): the kit's icon rail (round buttons, the primary one active) in an inset sidebar and its
 * site header with the community name, the current section and the notification bell. Below 1024px the rail is the Harvest bottom bar.
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
  const isActive = (item: Item) => Boolean(item.match?.some((m) => pathname.startsWith(m)));
  const label = (item: Item) => t(`items.${item.id}` as "items.forum");
  const section = items.find(isActive);

  return (
    <SidebarProvider
      open
      persist={false}
      className="min-h-dvh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 20)",
          "--header-height": "calc(var(--spacing) * 14)",
        } as React.CSSProperties
      }
    >
      <a href="#community-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">{t("skip")}</a>
      {/* The chat sizes itself to the screen under the header, so it keeps the plain rail without the inset margins. */}
      <AppSidebar variant={chatView ? "sidebar" : "inset"} items={items} isActive={isActive} label={label} />
      <SidebarInset className={cn("min-w-0 overflow-hidden lg:pb-0", !chatView && "pb-[calc(5rem+env(safe-area-inset-bottom))]")}>
        <SiteHeader title={name} subtitle={section ? label(section) : undefined} className={cn(chatView && "hidden md:flex")}>
          {notifications && <NotificationBell slug={slug} unread={notifications.unread} prefs={notifications.prefs} />}
        </SiteHeader>
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <main id="community-main" tabIndex={-1} className="min-w-0 flex-1 outline-none has-[[data-surface=sunken]]:bg-muted">
              <ChatUnreadContext.Provider value={setBadge}>{children}</ChatUnreadContext.Provider>
            </main>
          </div>
        </div>
      </SidebarInset>
      {/* Harvest-owned phone bar: every entry keeps a 44px target; on the narrowest phones the bar scrolls sideways instead of shrinking them. */}
      {!chatView && <nav aria-label={t("navigation")} className="fixed inset-x-0 bottom-0 z-40 grid overflow-x-auto border-t bg-background pt-1 pr-[calc(0.25rem+env(safe-area-inset-right))] pb-[calc(0.25rem+env(safe-area-inset-bottom))] pl-[calc(0.25rem+env(safe-area-inset-left))] lg:hidden" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(2.75rem, 1fr))` }}>
        {items.map((item) => <BarEntry key={item.id} item={item} active={isActive(item)} label={label(item)} />)}
      </nav>}
    </SidebarProvider>
  );
}

function AppSidebar({ items, isActive, label, ...props }: React.ComponentProps<typeof Sidebar> & { items: Item[]; isActive: (item: Item) => boolean; label: (item: Item) => string }) {
  const t = useTranslations("CommunityShell");
  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader className="py-6 md:items-center">
        <SidebarMenu className="items-center">
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="text-primary hover:text-primary size-12 justify-center rounded-lg data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <Link href="/account/communities" prefetch={false}>
                <Wheat className="size-8" aria-hidden="true" />
                <span className="sr-only">{t("myCommunities")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="justify-center">
        <NavMain items={items} isActive={isActive} label={label} />
      </SidebarContent>
    </Sidebar>
  );
}

function NavMain({ items, isActive, label }: { items: Item[]; isActive: (item: Item) => boolean; label: (item: Item) => string }) {
  const t = useTranslations("CommunityShell");
  return (
    <nav aria-label={t("navigation")}>
      <SidebarGroup className="px-0">
        <SidebarGroupContent>
          <SidebarMenu className="items-center gap-4">
            {items.map((item) => {
              const inner = <>
                <item.icon className="size-5" aria-hidden="true" />
                <span className="sr-only">
                  {label(item)}
                </span>
                <RailBadge item={item} />
              </>;
              return (
                <SidebarMenuItem key={item.id}>
                  {item.soon || !item.href ? <SidebarMenuButton
                    asChild
                    className="bg-background text-muted-foreground/60 hover:bg-background hover:text-muted-foreground/60 relative size-10 cursor-not-allowed justify-center rounded-full shadow-xs"
                  >
                    <span aria-disabled="true" title={t("comingSoon")}>{inner}<span className="sr-only">{t("comingSoon")}</span></span>
                  </SidebarMenuButton> : <SidebarMenuButton
                    asChild
                    tooltip={label(item)}
                    isActive={isActive(item)}
                    className="bg-background text-muted-foreground hover:bg-background data-[active=true]:bg-primary! data-[active=true]:text-primary-foreground data-[active=true]:hover:bg-primary! relative size-10 justify-center rounded-full shadow-xs"
                  >
                    <Link href={item.href} prefetch={false} aria-current={isActive(item) ? "page" : undefined}>{inner}</Link>
                  </SidebarMenuButton>}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </nav>
  );
}

function SiteHeader({ title, subtitle, className, children }: { title: string; subtitle?: string; className?: string; children?: React.ReactNode }) {
  return (
    <header className={cn("bg-muted text-foreground flex h-(--header-height) shrink-0 items-center", className)}>
      <div className="flex w-full min-w-0 items-center gap-2 px-4 lg:gap-4 lg:px-6">
        <div className="grid min-w-0 gap-0.5">
          <h1 className="truncate text-xl font-semibold">{title}</h1>
          {subtitle && <p className="text-muted-foreground truncate text-sm">
            {subtitle}
          </p>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {children}
        </div>
      </div>
    </header>
  );
}

/** The count on a rail icon (chat unread, items to review), with its own spoken text. */
function RailBadge({ item }: { item: Item }) {
  const t = useTranslations("CommunityShell");
  if (!item.badge) return null;
  return <>
    <span aria-hidden="true" className="bg-primary text-primary-foreground ring-background absolute -top-1 -right-1 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-medium ring-2">{item.badge > 99 ? t("manyItems") : item.badge}</span>
    <span className="sr-only">{t(item.id === "chat" ? "unread" : "toReview", { count: item.badge })}</span>
  </>;
}

/** One entry of the Harvest phone bar (not from the kit): icon, label from 640px, count. */
function BarEntry({ item, active, label }: { item: Item; active: boolean; label: string }) {
  const t = useTranslations("CommunityShell");
  const inner = <><span className="relative"><item.icon className="size-5" aria-hidden="true" />
    {item.badge ? <span className="absolute -top-1.5 -right-2.5 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground" aria-hidden="true">{item.badge > 99 ? t("manyItems") : item.badge}</span> : null}</span>
    <span className="sr-only text-[11px] leading-tight sm:not-sr-only">{label}</span>
    {item.badge ? <span className="sr-only">{t(item.id === "chat" ? "unread" : "toReview", { count: item.badge })}</span> : null}</>;
  const classes = "flex min-h-11 min-w-11 flex-col items-center justify-center gap-1 rounded-md px-1 py-1.5 text-center";
  if (item.soon || !item.href) return <span aria-disabled="true" title={t("comingSoon")} className={cn(classes, "cursor-not-allowed text-muted-foreground/60")}>
    {inner}<span className="sr-only">{t("comingSoon")}</span></span>;
  return <Link href={item.href} aria-current={active ? "page" : undefined} prefetch={false}
    className={cn(classes, active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")}>{inner}</Link>;
}
