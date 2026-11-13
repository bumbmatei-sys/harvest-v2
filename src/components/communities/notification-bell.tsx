"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Bell, Settings } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NotificationSettingsSheet } from "@/components/communities/notification-settings-sheet";
import { useRequest } from "@/hooks/use-request";
import { notificationHref, summaryKey, unreadDisplay, type NotificationPrefs, type NotificationView } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** C15a: the bell in the community header: a 44px button with the unread count, a popover list and the settings sheet. */
export function NotificationBell({ slug, unread, prefs }: { slug: string; unread: number; prefs: NotificationPrefs }) {
  const t = useTranslations("CommunityNotifications"), format = useFormatter(), request = useRequest(), router = useRouter();
  const [open, setOpen] = useState(false), [settings, setSettings] = useState(false), [items, setItems] = useState<NotificationView[] | null>(null);
  const [count, setCount] = useState(unread), [error, setError] = useState("");
  // The layout is not re-rendered on soft navigation: follow the server value when it changes, otherwise count locally.
  const [serverUnread, setServerUnread] = useState(unread);
  if (serverUnread !== unread) { setServerUnread(unread); setCount(unread); }
  const base = `/api/communities/${slug}/notifications`, shown = unreadDisplay(count);

  async function load() {
    setError("");
    const result = await request<{ unread: number; items: NotificationView[] }>(base, { method: "GET" });
    if (!result.ok) { setError(result.error); setItems([]); return; }
    setItems(result.data.items);
    // Opening the bell counts the announcements as seen; unread rows stay unread until opened or marked.
    setCount(result.data.items.filter((i) => i.kind !== "announcement" && !i.read).length);
    void request(`${base}/read`, { method: "POST", body: { ids: [] } });
  }
  async function markAll() {
    const result = await request(`${base}/read`, { method: "POST", body: { ids: null } });
    if (!result.ok) { setError(result.error); return; }
    setItems((list) => list?.map((i) => ({ ...i, read: true })) ?? list); setCount(0); router.refresh();
  }
  async function openItem(item: NotificationView) {
    if (item.kind !== "announcement" && !item.read) { await request(`${base}/read`, { method: "POST", body: { ids: [item.id] } }); setCount((c) => Math.max(0, c - 1)); }
    setOpen(false); router.push(notificationHref(slug, item));
  }
  const name = (item: NotificationView) => item.actorName?.trim() || t("someone");
  const line = (item: NotificationView) => t(`summary.${summaryKey(item)}` as "summary.reply", { name: name(item), others: Math.max(0, item.count - 1), count: item.count });

  return <>
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (next) void load(); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative size-11" aria-label={count > 0 ? t("bellUnread", { count: shown.value }) : t("bell")}>
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 && <span className="absolute top-1 right-1 min-w-4 rounded-full bg-primary px-1 text-[10px] leading-4 font-medium text-primary-foreground" aria-hidden="true">{shown.capped ? t("many") : shown.value}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex min-h-12 items-center justify-between gap-2 border-b px-3">
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="min-h-11" disabled={count === 0} onClick={() => void markAll()}>{t("markAllRead")}</Button>
            <Button variant="ghost" size="icon" className="size-11" aria-label={t("settings")} onClick={() => { setOpen(false); setSettings(true); }}><Settings aria-hidden="true" /></Button>
          </div>
        </div>
        {error && <Alert variant="destructive" role="alert" className="m-2"><AlertDescription>{error}</AlertDescription></Alert>}
        {items === null ? <p className="p-4 text-sm text-muted-foreground" role="status">{t("loading")}</p>
          : items.length === 0 ? <Empty className="border-0"><EmptyHeader><EmptyTitle>{t("empty")}</EmptyTitle></EmptyHeader></Empty>
          : <ul className="max-h-96 overflow-y-auto">{items.map((item) => <li key={item.id}>
            <button type="button" onClick={() => void openItem(item)} className={cn("flex min-h-11 w-full items-start gap-3 px-3 py-2 text-left hover:bg-muted/60", !item.read && "bg-muted/40")}>
              <Avatar className="size-8"><AvatarFallback>{name(item).slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
              <span className="min-w-0 flex-1">
                <span className="block text-sm break-words">{line(item)}</span>
                <span className="block text-xs text-muted-foreground">{format.relativeTime(new Date(item.createdAt), new Date())}</span>
              </span>
              {!item.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
              {!item.read && <span className="sr-only">{t("unread")}</span>}
            </button></li>)}</ul>}
      </PopoverContent>
    </Popover>
    <NotificationSettingsSheet key={JSON.stringify(prefs)} slug={slug} prefs={prefs} open={settings} onOpenChange={setSettings} />
  </>;
}
