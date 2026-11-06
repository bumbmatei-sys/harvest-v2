import { getFormatter, getTranslations } from "next-intl/server";
import { ListChecks } from "lucide-react";
import { getDb } from "@/db/client";
import { listRelatedTasks } from "@/server/crm-tasks";
import { can } from "@/server/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TaskDialog, type Relation } from "./task-dialog";
import { TaskRows } from "./task-rows";

/** Tasks card on person, company and deal pages. Rendered only for roles that can read tasks. */
export async function RelatedTasks({ tenantId, userId, role, type, record }: {
  tenantId: string; userId: string; role: string; type: "person" | "company" | "deal"; record: { id: string; name: string };
}) {
  if (!can(role, "tasks:read")) return null;
  const t = await getTranslations("Tasks");
  const format = await getFormatter();
  const { tasks, members, now } = await listRelatedTasks(getDb(), userId, tenantId, type, record.id);
  const link: Relation = { id: record.id, label: record.name };
  const writable = can(role, "tasks:write");
  const open = tasks.filter((task) => task.status === "open").length;
  return <Card className="gap-3">
    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="size-4 text-muted-foreground" aria-hidden="true" />{t("tasks")}
      <Badge variant="secondary" className="rounded-md tabular-nums">{format.number(open, "integer")}</Badge></CardTitle>
      {writable && <CardAction><TaskDialog tenantId={tenantId} members={members} currentUserId={userId} variant="outline" compact
        contact={type === "person" ? link : null} company={type === "company" ? link : null} deal={type === "deal" ? link : null} /></CardAction>}</CardHeader>
    <CardContent>{tasks.length
      ? <TaskRows tenantId={tenantId} tasks={tasks} members={members} currentUserId={userId} writable={writable} now={now} label={t("tasksFor", { record: record.name })}
        hide={type === "person" ? ["contact"] : type === "company" ? ["company"] : ["deal"]} />
      : <p className="text-xs text-muted-foreground">{writable ? t("noTasksOnRecord") : t("noTasksOnRecordViewer")}</p>}</CardContent>
  </Card>;
}
