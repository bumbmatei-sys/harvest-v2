import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getImport, rowOutcomes, type RowOutcome } from "@/server/crm-imports";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { ImportRows } from "@/components/crm/imports/import-rows";
import { ImportStatusBadge } from "@/components/crm/imports/import-status";
import { ImportRunner, MappingStep, RollbackButton } from "@/components/crm/imports/import-steps";
import { RecordBackLink, RecordHeader } from "@/components/crm/record-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Imports");
  return { title: t("pageTitle", { page: t("imports") }) };
}

export default async function ImportPage({ params, searchParams }: { params: Promise<{ tenantId: string; importId: string }>; searchParams: Promise<{ outcome?: string; page?: string; step?: string }> }) {
  const t = await getTranslations("Imports");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId, importId } = await params, query = await searchParams;
  const back = `/workspaces/${tenantId}/crm/imports`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(importId).success) return <AccessState missing kind="import" href={back} />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "crm:import")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const outcome: RowOutcome = (rowOutcomes as readonly string[]).includes(query.outcome ?? "") ? query.outcome as RowOutcome : "all";
  const item = await getImport(getDb(), session.user.id, tenantId, importId, { outcome, page: Number(query.page) || 1 })
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!item) return <AccessState missing kind="import" href={back} />;
  const finished = item.status === "completed" || item.status === "failed" || item.status === "rolled_back";
  const mapping = item.status === "draft" || (item.status === "preview" && query.step === "map");
  const step = mapping ? 0 : item.status === "preview" ? 1 : item.status === "running" ? 2 : 3;
  const stats = item.stats, problems = (stats.error ?? 0) + (stats.conflict ?? 0);
  const ready = (stats.create ?? 0) + (stats.update ?? 0);
  const list = item.entity === "person" ? t("people") : t("companies");
  const canRollBack = (item.status === "completed" || item.status === "failed") && (workspace.role === "owner" || workspace.role === "admin" || item.createdBy === session.user.id);
  const samples = mapping ? (await getImport(getDb(), session.user.id, tenantId, importId, { page: 1 })).rows.slice(0, 3).map((row) => row.raw) : [];
  return <div className="space-y-4">
    <RecordHeader back={<RecordBackLink href={back} label={t("backToImports")} />}>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-semibold tracking-tight">{t("importTitle", { file: item.fileName })}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><ImportStatusBadge status={item.status} /><span>{list}</span>
          <span>{t("rowCount", { count: item.rowCount })}</span><time dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, "date")}</time>{item.creatorName && <span>{item.creatorName}</span>}</p>
      </div>
    </RecordHeader>
    <ol aria-label={t("steps.label")} className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {(["map", "preview", "import", "results"] as const).map((name, index) => <li key={name} aria-current={index === step ? "step" : undefined}
        className={cn("flex items-center gap-2", index === step ? "font-medium text-foreground" : "text-muted-foreground")}>
        <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs tabular-nums", index === step && "border-foreground bg-foreground text-background", index < step && "bg-selected")}>{index + 1}</span>{t(`steps.${name}`)}</li>)}
    </ol>
    {mapping && <Card className="gap-4"><CardHeader><CardTitle><h2 className="text-base">{t("mapTitle")}</h2></CardTitle><CardDescription>{t("mapDescription")}</CardDescription></CardHeader>
      <CardContent><MappingStep tenantId={tenantId} importId={item.id} entity={item.entity} headers={item.headers} samples={samples} mapping={item.mapping} onMatch={item.onMatch} version={item.version} /></CardContent></Card>}
    {!mapping && <Card className="gap-4">
      <CardHeader><CardTitle><h2 className="text-base">{finished ? t("resultsTitle") : t("previewTitle")}</h2></CardTitle>
        <CardDescription>{item.status === "rolled_back" ? t("rolledBackDescription", { removed: stats.removed ?? 0, reverted: stats.reverted ?? 0, kept: stats.kept ?? 0 })
          : item.status === "failed" ? t("failedDescription") : item.status === "completed" ? t("completedDescription") : t("previewDescription")}</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(finished ? [["created", stats.created], ["updated", stats.updated], ["skipped", stats.skipped], ["failed", stats.failed]] as const
            : [["create", stats.create], ["update", stats.update], ["skip", stats.skip], ["problem", problems]] as const).map(([key, value]) =>
            <div key={key} className="rounded-lg border px-3 py-2"><dt className="text-xs text-muted-foreground">{finished ? t(`stat.${key as "created"}`) : t(`outcomes.${key as "create"}`)}</dt>
              <dd className="text-xl font-semibold tabular-nums">{format.number(value ?? 0)}</dd></div>)}
        </dl>
        <div className="flex flex-wrap items-start gap-2">
          {item.status === "preview" && <><ImportRunner tenantId={tenantId} importId={item.id} total={ready} done={0} ready={ready} />
            <Button className="min-h-11" variant="outline" asChild><Link href={`${back}/${item.id}?step=map`}>{t("changeMapping")}</Link></Button></>}
          {item.status === "running" && <ImportRunner tenantId={tenantId} importId={item.id} total={ready} done={Math.max(0, ready - item.remaining)} ready={ready} resume />}
          {finished && (stats.failed ?? 0) > 0 && <Button className="min-h-11" variant="outline" asChild><a href={`/api/workspaces/${tenantId}/crm/imports/${item.id}/report`} download><Download aria-hidden="true" />{t("downloadReport")}</a></Button>}
          {finished && <Button className="min-h-11" variant="outline" asChild><Link href={`/workspaces/${tenantId}/crm/${item.entity === "person" ? "people" : "companies"}`}>{t("viewList", { list })}</Link></Button>}
          {canRollBack && <RollbackButton tenantId={tenantId} importId={item.id} />}
        </div>
        <ImportRows tenantId={tenantId} importId={item.id} entity={item.entity} fileName={item.fileName} mapping={item.mapping} rows={item.rows}
          outcome={outcome} page={item.page} total={item.total} done={finished} counts={{ all: item.rowCount, create: stats.create ?? 0, update: stats.update ?? 0, skip: stats.skip ?? 0, problem: problems }} />
      </CardContent>
    </Card>}
  </div>;
}
