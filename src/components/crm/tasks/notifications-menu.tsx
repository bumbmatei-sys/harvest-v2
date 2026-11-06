"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { CRM_TIME_ZONE } from "@/lib/crm-deals";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useCrmRequest } from "../request";

type Item = { id: string; taskId: string; taskTitle: string; taskStatus: string; readAt: string | null; createdAt: string; actorName: string | null };
type Data = { items: Item[]; unread: number; overdue: number };

/**
 * Bounded in-app notifications (CRM-05): tasks assigned to me, plus a count of my
 * overdue tasks computed on read. Not the full notification centre (PRD §24).
 */
export function NotificationsMenu({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Tasks");
  const format = useFormatter();
  const pathname = usePathname();
  const crmRequest = useCrmRequest();
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(""), [open, setOpen] = useState(false);
  const endpoint = `/api/workspaces/${tenantId}/crm/notifications`;
  const load = useCallback(async () => {
    const result = await crmRequest<Data>(endpoint, { method: "GET" });
    if (result.ok) { setData(result.data); setError(""); } else setError(result.error);
  }, [crmRequest, endpoint]);
  // Refresh on navigation, so the badge follows assignments made elsewhere in the app.
  useEffect(() => {
    let cancelled = false;
    crmRequest<Data>(endpoint, { method: "GET" }).then((result) => {
      if (cancelled) return;
      if (result.ok) { setData(result.data); setError(""); } else setError(result.error);
    });
    return () => { cancelled = true; };
  }, [crmRequest, endpoint, pathname]);
  async function markAll() {
    const result = await crmRequest(endpoint, { method: "POST", body: { ids: "all" } });
    if (result.ok) void load(); else setError(result.error);
  }
  const unread = data?.unread ?? 0, overdue = data?.overdue ?? 0;
  const label = unread ? t("notificationsUnread", { count: unread }) : t("notifications");
  return <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) void load(); }}>
    <PopoverTrigger asChild><Button variant="ghost" size="icon-sm" className="relative" aria-label={label}>
      <Bell aria-hidden="true" />{unread > 0 && <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-primary" />}
    </Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-medium">{t("notifications")}</p>
        {unread > 0 && <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void markAll()}>{t("markAllRead")}</Button>}
      </div>
      {error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{error}</p>}
      {overdue > 0 && <Link href={`/workspaces/${tenantId}/crm/tasks?due=overdue`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm hover:bg-muted">
        <span>{t("youHaveOverdue", { count: overdue })}</span><Badge variant="secondary" className="bg-warning-tint text-warning">{t("overdue")}</Badge></Link>}
      {data && data.items.length === 0 && overdue === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("noNotifications")}</p>}
      {data && data.items.length > 0 && <ul className="max-h-80 overflow-y-auto" aria-label={t("notifications")}>{data.items.map((item) => <li key={item.id}>
        <Link href={`/workspaces/${tenantId}/crm/tasks?assignee=me&status=all`} onClick={() => setOpen(false)} className={cn("block px-3 py-2 text-sm hover:bg-muted", !item.readAt && "bg-selected/50")}>
          <span className="block">{t.rich("assignedYou", { actor: item.actorName ?? t("aWorkspaceMember"), task: () => <span className="font-medium">{item.taskTitle}</span> })}</span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground"><time dateTime={item.createdAt}>{format.dateTime(new Date(item.createdAt), { dateStyle: "medium", timeStyle: "short", timeZone: CRM_TIME_ZONE })}</time>
            {!item.readAt && <span>{t("unread")}</span>}{item.taskStatus === "done" && <span>{t("statuses.done")}</span>}</span>
        </Link></li>)}</ul>}
      <div className="border-t px-3 py-2"><Link href={`/workspaces/${tenantId}/crm/tasks`} onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:text-foreground hover:underline">{t("openMyTasks")}</Link></div>
    </PopoverContent>
  </Popover>;
}
