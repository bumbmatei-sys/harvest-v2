import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Building2, CalendarDays, History, Kanban, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getDeal } from "@/server/crm-deals";
import { getTimeline } from "@/server/activity";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { isStale } from "@/lib/crm-deals";
import { AccessState } from "@/components/access-state";
import { ActivityTimeline, NoteComposer } from "@/components/crm/activity-timeline";
import { RelatedTasks } from "@/components/crm/tasks/related-tasks";
import { RecordProvider } from "@/components/crm/record-context";
import { RecordTitle } from "@/components/crm/record-title";
import { RecordBackLink, RecordGrid, RecordHeader } from "@/components/crm/record-layout";
import { StaleNotice } from "@/components/crm/stale-notice";
import { DealAmountField, DealArchiveControl, DealCloseDateField, DealOwnerControl, DealReasonField, DealRelationControl, DealStageControl } from "@/components/crm/deals/deal-controls";
import { StaleBadge, StageBadge } from "@/components/crm/deals/stage-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Deals");
  return { title: t("pageTitle", { page: t("deal") }) };
}

export default async function DealPage({ params }: { params: Promise<{ tenantId: string; dealId: string }> }) {
  const t = await getTranslations("Deals");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId, dealId } = await params;
  const back = `/workspaces/${tenantId}/crm/pipelines`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(dealId).success) return <AccessState missing kind="deal" href={back} />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getDeal(getDb(), session.user.id, tenantId, dealId), getTimeline(getDb(), session.user.id, tenantId, "deal", dealId)])
    .catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} kind="deal" href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, { deal, pipeline, members, today }, timeline] = result;
  const writable = can(workspace.role, "opportunities:write") && !deal.archivedAt;
  const stage = pipeline.stages.find((item) => item.id === deal.stageId)!;
  const board = pipeline.isDefault ? back : `${back}/${pipeline.id}`;
  // An archived deal takes no new or changed notes (the API answers 409 parent_archived).
  const notesWritable = can(workspace.role, "notes:write") && !deal.archivedAt;
  const late = isStale(stage.kind, deal.expectedCloseDate, today);
  return <RecordProvider endpoint={`/api/workspaces/${tenantId}/crm/deals/${dealId}`} version={deal.version} writable={writable}>
    <div className="space-y-4">
      <RecordHeader back={<RecordBackLink href={board} label={t("backToPipeline", { pipeline: pipeline.name })} />}>
        <div className="min-w-0 flex-1">
          <RecordTitle field="name" value={deal.name} label={t("dealName")} maxLength={200} />
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StageBadge name={stage.name} color={stage.color} />
            <span className="flex items-center gap-1.5"><Kanban className="size-3.5" aria-hidden="true" />{pipeline.name}</span>
            <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{t("createdOn", { date: format.dateTime(deal.createdAt, "date") })}</span>
            {late && <StaleBadge label={t("stale")} />}
          </p>
        </div>
      </RecordHeader>
      {deal.archivedAt && <Alert><AlertDescription className="flex flex-wrap items-center gap-3">{t("archivedDealNotice")}{can(workspace.role, "opportunities:write") && <RecordProvider endpoint={`/api/workspaces/${tenantId}/crm/deals/${dealId}`} version={deal.version} writable><DealArchiveControl archived board={board} /></RecordProvider>}</AlertDescription></Alert>}
      {!can(workspace.role, "opportunities:write") && <Alert><AlertDescription>{t("viewOnlyDeal")}</AlertDescription></Alert>}
      {late && <Alert><AlertDescription>{t("staleDealNotice")}</AlertDescription></Alert>}
      <StaleNotice />
      <RecordGrid
        profile={<Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Kanban className="size-4 text-muted-foreground" aria-hidden="true" />{t("dealDetails")}</CardTitle></CardHeader>
          <CardContent className="space-y-0.5">
            <DealStageControl stageId={deal.stageId} stages={pipeline.stages.map((item) => ({ id: item.id, name: item.name, kind: item.kind, archived: !!item.archivedAt }))} />
            <DealAmountField value={deal.amount ?? ""} />
            <DealCloseDateField value={deal.expectedCloseDate ?? ""} />
            <DealOwnerControl ownerUserId={deal.ownerUserId} ownerName={deal.ownerName} members={members} />
            {stage.kind !== "open" && <DealReasonField value={deal.closedReason ?? ""} />}
            {stage.probability !== null && stage.kind === "open" && <p className="px-2 pt-2 text-xs text-muted-foreground">{t("probabilityNote", { value: stage.probability })}</p>}
          </CardContent></Card>}
        context={<Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" />{t("linkedTo")}</CardTitle></CardHeader>
          <CardContent className="space-y-0.5">
            <DealRelationControl kind="company" tenantId={tenantId} value={deal.companyId} name={deal.companyName} otherLinked={!!deal.contactId} />
            <DealRelationControl kind="person" tenantId={tenantId} value={deal.contactId} name={deal.contactName} otherLinked={!!deal.companyId} />
            {!deal.companyId && !deal.contactId && <p className="flex items-center gap-1.5 px-2 pt-2 text-xs text-muted-foreground"><UserRound className="size-3.5" aria-hidden="true" />{t("noRelationHelp")}</p>}
          </CardContent></Card>}
        history={<div className="space-y-4">
          <RelatedTasks tenantId={tenantId} userId={session.user.id} role={workspace.role} type="deal" record={{ id: deal.id, name: deal.name }} locked={!!deal.archivedAt}
            prefill={{ contact: deal.contactId && deal.contactName ? { id: deal.contactId, label: deal.contactName } : null, company: deal.companyId && deal.companyName ? { id: deal.companyId, label: deal.companyName } : null }} />
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><History className="size-4 text-muted-foreground" aria-hidden="true" />{t("activityTitle")}</CardTitle></CardHeader>
          <CardContent className="space-y-5">{notesWritable && <NoteComposer tenantId={tenantId} target="deal" targetId={dealId} />}
            <ActivityTimeline items={timeline.items} nextCursor={timeline.nextCursor} endpoint={`/api/workspaces/${tenantId}/crm/deals/${dealId}/timeline`} tenantId={tenantId} subject="deal" currentUserId={session.user.id}
              canWriteNotes={notesWritable} canModerate={notesWritable && (workspace.role === "owner" || workspace.role === "admin")} /></CardContent></Card></div>} />
      {!deal.archivedAt && <div className="flex justify-end"><DealArchiveControl archived={false} board={board} /></div>}
    </div>
  </RecordProvider>;
}
