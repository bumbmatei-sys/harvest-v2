import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { FileUp } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listImports } from "@/server/crm-imports";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { NewImportDialog } from "@/components/crm/imports/new-import-dialog";
import { ImportStatusBadge } from "@/components/crm/imports/import-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Imports");
  return { title: t("pageTitle", { page: t("imports") }) };
}

export default async function ImportsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<{ entity?: string }> }) {
  const t = await getTranslations("Imports");
  const crm = await getTranslations("Crm");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params, { entity } = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:import")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const imports = await listImports(getDb(), session.user.id, tenantId);
  const preset = entity === "company" ? "company" : "person";
  const base = `/workspaces/${tenantId}/crm/imports`;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><FileUp className="size-3.5" aria-hidden="true" />{crm("crm")}</div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("imports")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(imports.length, "integer")}</Badge></h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("description")}</p></div>
      <NewImportDialog tenantId={tenantId} entity={preset} defaultOpen={entity === "person" || entity === "company"} />
    </div>
    {imports.length === 0
      ? <Empty className="rounded-xl border"><EmptyHeader><EmptyMedia variant="icon"><FileUp aria-hidden="true" /></EmptyMedia>
        <EmptyTitle><h2>{t("noImportsYet")}</h2></EmptyTitle><EmptyDescription>{t("noImportsYetDescription")}</EmptyDescription></EmptyHeader>
        <EmptyContent><NewImportDialog tenantId={tenantId} entity={preset} /></EmptyContent></Empty>
      : <Card className="gap-3"><CardHeader><CardTitle className="text-sm"><h2>{t("history")}</h2></CardTitle></CardHeader>
        <CardContent><Table className="table-fixed w-full" aria-label={t("history")}>
          <TableHeader><TableRow>
            <TableHead>{t("columns.file")}</TableHead><TableHead className="hidden sm:table-cell">{t("columns.type")}</TableHead><TableHead>{t("columns.status")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("columns.result")}</TableHead><TableHead className="hidden xl:table-cell">{t("columns.by")}</TableHead><TableHead className="hidden sm:table-cell">{t("columns.started")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{imports.map((item) => <TableRow key={item.id}>
            <TableCell className="min-w-0 max-w-[16rem] truncate"><Link href={`${base}/${item.id}`} className="flex min-h-11 min-w-0 items-center overflow-hidden font-medium hover:underline">{item.fileName}</Link>
              <span className="text-xs text-muted-foreground sm:hidden">{item.entity === "person" ? t("people") : t("companies")}</span></TableCell>
            <TableCell className="hidden sm:table-cell">{item.entity === "person" ? t("people") : t("companies")}</TableCell>
            <TableCell><ImportStatusBadge status={item.status} /></TableCell>
            <TableCell className="hidden min-w-0 truncate text-xs text-muted-foreground md:table-cell">{item.completedAt
              ? t("resultSummary", { created: item.stats.created ?? 0, updated: item.stats.updated ?? 0, skipped: item.stats.skipped ?? 0, failed: item.stats.failed ?? 0 })
              : t("notStarted")}</TableCell>
            <TableCell className="hidden min-w-0 truncate text-xs text-muted-foreground xl:table-cell">{item.creatorName}</TableCell>
            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell"><time dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, "date")}</time></TableCell>
          </TableRow>)}</TableBody>
        </Table></CardContent></Card>}
  </div>;
}
