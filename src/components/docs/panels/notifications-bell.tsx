"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDocsCall } from "@/components/docs/docs-api";
import { docHref } from "@/lib/docs-list";
import type { NotificationRow } from "@/server/docs-notify";

/** The Docs bell: mentions, replies, assignments and shares, in the app only. */
export function NotificationsBell({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Docs"), format = useFormatter(), call = useDocsCall(tenantId);
  const [data, setData] = useState<{ items: NotificationRow[]; unread: number } | null>(null), [open, setOpen] = useState(false);
  const load = useCallback(async () => { const r = await call<{ items: NotificationRow[]; unread: number }>("GET", "/notifications"); if (r.ok) setData(r.data); }, [call]);
  useEffect(() => { let live = true; call<{ items: NotificationRow[]; unread: number }>("GET", "/notifications").then((r) => { if (live && r.ok) setData(r.data); }); return () => { live = false; }; }, [call]);
  async function markAll() { await call("POST", "/notifications", { ids: "all" }); void load(); }
  const unread = data?.unread ?? 0;
  return <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); }}>
    <PopoverTrigger asChild><Button type="button" variant="ghost" className="min-h-11 gap-1 px-2" aria-label={unread ? t("notificationsUnread", { count: unread }) : t("notifications")}><Bell aria-hidden="true" /><span className="text-sm tabular-nums" aria-hidden="true">{unread}</span></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0">
      <div className="flex items-center justify-between border-b px-3 py-2"><p className="text-sm font-medium">{t("notifications")}</p>{unread > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => void markAll()}>{t("markAllRead")}</Button>}</div>
      {data && data.items.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("noNotifications")}</p>
        : <ul className="max-h-80 overflow-y-auto">{data?.items.map((n) => <li key={n.id}><Link href={docHref(tenantId, n.docId, n.pageId ?? undefined)} onClick={() => setOpen(false)} className="block px-3 py-2 text-sm hover:bg-accent">
          <span className={n.readAt ? "" : "font-medium"}>{t(`notification.${n.kind}`, { name: n.actorName, doc: n.docTitle || t("untitled") })}</span>
          <span className="block text-xs text-muted-foreground">{format.dateTime(new Date(n.createdAt), { dateStyle: "medium", timeStyle: "short" })}</span></Link></li>)}</ul>}
    </PopoverContent>
  </Popover>;
}
