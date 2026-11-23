import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, FileUp } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCrmImportDiagnostics } from "@/server/crm-diagnostics";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { defineStatusTones } from "@/lib/status-tone";
import { AccessState } from "@/components/access-state";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

const statusTone = defineStatusTones({ draft: "pending", preview: "pending", running: "info", completed: "success", failed: "warning", rolled_back: "neutral" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("ImportStatus");
  return { title: t("pageTitle") };
}

/** Read-only import support screen for owners and admins, on `GET /crm/diagnostics`: lifecycle metadata only, no file names or rows. */
export default async function ImportStatusPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const t = await getTranslations("ImportStatus"), imports = await getTranslations("Imports");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:read_diagnostics")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const result = await getCrmImportDiagnostics(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  const when = (value: string | null) => value ? <time dateTime={value}>{format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" })}</time> : t("none");
  const columns: DataTableColumn[] = [
    { id: "type", header: t("columns.type"), card: "title" }, { id: "status", header: t("columns.status") },
    { id: "started", header: t("columns.started"), showFrom: "@md" }, { id: "updated", header: t("columns.updated"), showFrom: "@lg" }, { id: "finished", header: t("columns.finished"), showFrom: "@lg" },
  ];
  const rows: DataTableRow[] = (result?.imports ?? []).map((item) => ({
    id: item.id, label: item.entity === "person" ? imports("people") : imports("companies"),
    cells: {
      type: item.entity === "person" ? imports("people") : imports("companies"),
      status: <StatusBadge tone={statusTone(item.status)} label={imports(`statuses.${item.status}`)} />,
      started: when(item.createdAt as string), updated: when(item.updatedAt as string), finished: when((item.rolledBackAt ?? item.completedAt) as string | null),
    },
  }));
  return <div className="space-y-4">
    <div>
      <Link href={`/workspaces/${tenantId}/crm/imports`} className="mb-1.5 inline-flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden="true" />{imports("imports")}</Link>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
    </div>
    <DataTable label={t("title")} note={result ? t("note", { count: rows.length }) : undefined} columns={columns} rows={rows} state={result ? "ready" : "error"}
      empty={<EmptyState icon={FileUp} title={t("emptyTitle")} size="compact" />} error={<Alert variant="destructive"><AlertDescription>{t("error")}</AlertDescription></Alert>} />
  </div>;
}
