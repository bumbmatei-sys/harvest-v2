"use client";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CRM_TIME_ZONE } from "@/lib/crm-deals";
import { isOverdue, type TaskPriority, type TaskStatus } from "@/lib/crm-tasks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCrmRequest } from "../request";
import { TaskDialog } from "./task-dialog";

export type TaskRowData = {
  id: string; version: number; title: string; body: string; status: TaskStatus; priority: TaskPriority; dueAt: Date | string | null;
  assigneeUserId: string | null; assigneeName: string | null; contactId: string | null; contactName: string | null;
  companyId: string | null; companyName: string | null; opportunityId: string | null; dealName: string | null;
};

/**
 * Task rows with a completion checkbox (Space toggles it from the keyboard). The toggle
 * applies at once and is sent with the task's version; a refusal (for example a stale
 * version) puts it back and says why, with a Reload for conflicts.
 */
export function TaskRows({ tenantId, tasks, members, currentUserId, writable, now, hide = [], label }: {
  tenantId: string; tasks: TaskRowData[]; members: { id: string; name: string }[]; currentUserId: string; writable: boolean; now: string;
  hide?: ("contact" | "company" | "deal")[]; label: string;
}) {
  const t = useTranslations("Tasks");
  const format = useFormatter();
  const router = useRouter();
  const crmRequest = useCrmRequest();
  const [pending, setPending] = useState<Record<string, TaskStatus>>({}), [error, setError] = useState(""), [stale, setStale] = useState(false);
  async function toggle(task: TaskRowData, done: boolean) {
    const status: TaskStatus = done ? "done" : "open";
    setPending((current) => ({ ...current, [task.id]: status })); setError("");
    const result = await crmRequest(`/api/workspaces/${tenantId}/crm/tasks/${task.id}`, { method: "PATCH", body: { status, version: task.version } });
    if (!result.ok) {
      setPending((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setError(result.error); setStale(result.details?.reason === "stale");
      return;
    }
    router.refresh();
  }
  const base = `/workspaces/${tenantId}/crm`;
  return <div className="space-y-2">
    {error && <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">{error}{stale && <Button size="sm" variant="outline" className="h-7" onClick={() => { setError(""); setStale(false); setPending({}); router.refresh(); }}>{t("reload")}</Button>}</p>}
    <ul className="divide-y" aria-label={label}>{tasks.map((task) => {
      const status = pending[task.id] ?? task.status, overdue = isOverdue(status, task.dueAt, new Date(now));
      const links = [
        !hide.includes("contact") && task.contactId && task.contactName ? { href: `${base}/people/${task.contactId}`, label: task.contactName } : null,
        !hide.includes("company") && task.companyId && task.companyName ? { href: `${base}/companies/${task.companyId}`, label: task.companyName } : null,
        !hide.includes("deal") && task.opportunityId && task.dealName ? { href: `${base}/deals/${task.opportunityId}`, label: task.dealName } : null,
      ].filter((item): item is { href: string; label: string } => !!item);
      return <li key={task.id} className="flex min-w-0 items-start gap-3 py-2.5 first:pt-0 last:pb-0">
        <Checkbox className="mt-0.5 border-muted-foreground/50" checked={status === "done"} disabled={!writable || task.id in pending} aria-label={status === "done" ? t("reopenTask", { task: task.title }) : t("completeTask", { task: task.title })}
          onCheckedChange={(checked) => void toggle(task, checked === true)} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium [overflow-wrap:anywhere]", status === "done" && "text-muted-foreground line-through")}>{task.title}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {task.dueAt && <time dateTime={new Date(task.dueAt).toISOString()} className={cn(overdue && "text-warning")}>{t("dueOn", { date: format.dateTime(new Date(task.dueAt), { dateStyle: "medium", timeStyle: "short", timeZone: CRM_TIME_ZONE }) })}</time>}
            {overdue && <Badge variant="secondary" className="h-5 rounded-md bg-warning-tint px-1.5 text-[11px] font-normal text-warning">{t("overdue")}</Badge>}
            {task.priority !== "none" && <Badge variant="outline" className="h-5 rounded-md px-1.5 text-[11px] font-normal">{t(`priorities.${task.priority}`)}</Badge>}
            <span>{task.assigneeUserId ? task.assigneeUserId === currentUserId ? t("assignedToYou") : t("assignedTo", { name: task.assigneeName ?? t("formerMember") }) : t("unassigned")}</span>
            {links.map((link) => <Link key={link.href} href={link.href} className="max-w-full truncate hover:text-foreground hover:underline">{link.label}</Link>)}
          </div>
        </div>
        {writable && <TaskDialog tenantId={tenantId} members={members} currentUserId={currentUserId} task={{
          id: task.id, version: task.version, title: task.title, body: task.body, priority: task.priority, dueAt: task.dueAt, assigneeUserId: task.assigneeUserId,
          contact: task.contactId ? { id: task.contactId, label: task.contactName ?? t("unavailableRecord") } : null,
          company: task.companyId ? { id: task.companyId, label: task.companyName ?? t("unavailableRecord") } : null,
          deal: task.opportunityId ? { id: task.opportunityId, label: task.dealName ?? t("unavailableRecord") } : null,
        }} />}
      </li>;
    })}</ul>
  </div>;
}
