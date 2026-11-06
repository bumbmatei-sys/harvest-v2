import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listTasks } from "@/server/crm-tasks";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { parseTaskQuery, taskQuery, taskQueryParams } from "@/lib/crm-tasks";
import { AccessState } from "@/components/access-state";
import { RecordPagination } from "@/components/crm/record-pagination";
import { TaskDialog } from "@/components/crm/tasks/task-dialog";
import { TaskRows } from "@/components/crm/tasks/task-rows";
import { TaskToolbar } from "@/components/crm/tasks/task-toolbar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Tasks");
  return { title: t("pageTitle", { page: t("tasks") }) };
}

/** Tasks: assigned to me and open by default; every filter is URL state. */
export default async function TasksPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Tasks");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const parsed = parseTaskQuery(await searchParams);
  const query = parsed.success ? parsed.data : taskQuery.parse({});
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const result = await listTasks(db, session.user.id, tenantId, query).catch((error: unknown) => {
    if (error instanceof AccessError && error.status === 400) return listTasks(db, session.user.id, tenantId, taskQuery.parse({})).then((data) => ({ ...data, notice: true }));
    throw error;
  });
  const writable = can(workspace.role, "tasks:write"), base = `/workspaces/${tenantId}/crm/tasks`;
  const filtered = query.assignee !== "me" || query.status !== "open" || !!query.due || !!query.related || !!query.q;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><ListChecks className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("tasks")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(result.total, "integer")}</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("tasksDescription")}</p></div>
      {writable && <TaskDialog tenantId={tenantId} members={result.members} currentUserId={session.user.id} />}
    </div>
    {(!parsed.success || "notice" in result) && <Alert variant="destructive"><AlertDescription>{t("invalidFiltersNotice")}</AlertDescription></Alert>}
    {!writable && <Alert><AlertDescription>{t("viewOnlyTasks")}</AlertDescription></Alert>}
    <TaskToolbar query={query} members={result.members} currentUserId={session.user.id} />
    {result.tasks.length ? <div className="space-y-3">
      <Card className="py-4"><CardContent className="px-4">
        <TaskRows tenantId={tenantId} tasks={result.tasks} members={result.members} currentUserId={session.user.id} writable={writable} now={result.now} label={t("taskList")} />
      </CardContent></Card>
      <RecordPagination base={base} params={taskQueryParams({ ...query, page: 1 }).toString()} page={result.page} total={result.total} label={t("taskPages")} />
    </div> : <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
      <EmptyHeader><EmptyMedia variant="icon"><ListChecks aria-hidden="true" /></EmptyMedia>
        <EmptyTitle><h2>{result.empty ? t("noTasksYet") : filtered ? t("noMatchingTasks") : t("nothingAssignedToYou")}</h2></EmptyTitle>
        <EmptyDescription>{result.empty ? (writable ? t("noTasksYetHelp") : t("noTasksYetViewer")) : filtered ? t("noMatchingTasksHelp") : t("nothingAssignedToYouHelp")}</EmptyDescription></EmptyHeader>
      <EmptyContent>{!result.empty && <Button variant="outline" asChild><Link href={filtered ? base : `${base}?assignee=any`}>{filtered ? t("resetFilters") : t("showEveryonesTasks")}</Link></Button>}
        {result.empty && writable && <TaskDialog tenantId={tenantId} members={result.members} currentUserId={session.user.id} variant="outline" />}</EmptyContent>
    </Empty>}
  </div>;
}
