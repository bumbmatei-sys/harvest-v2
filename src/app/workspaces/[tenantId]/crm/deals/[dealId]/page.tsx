import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Building2, CalendarDays, History, Kanban, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getDeal } from "@/server/crm-deals";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { isStale } from "@/lib/crm-deals";
import { AccessState } from "@/components/access-state";
import { RecordProvider } from "@/components/crm/record-context";
import { RecordTitle } from "@/components/crm/record-title";
import { RecordBackLink, RecordGrid, RecordHeader } from "@/components/crm/record-layout";
import { StaleNotice } from "@/components/crm/stale-notice";
import { DealAmountField, DealArchiveControl, DealCloseDateField, DealOwnerControl, DealReasonField, DealRelationControl, DealStageControl } from "@/components/crm/deals/deal-controls";
import { StaleBadge, StageBadge } from "@/components/crm/deals/stage-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

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
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getDeal(getDb(), session.user.id, tenantId, dealId)])
    .catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} kind="deal" href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, { deal, pipeline, members, activity, today }] = result;
  const writable = can(workspace.role, "opportunities:write") && !deal.archivedAt;
  const stage = pipeline.stages.find((item) => item.id === deal.stageId)!;
  const board = pipeline.isDefault ? back : `${back}/${pipeline.id}`;
  const late = isStale(stage.kind, deal.expectedCloseDate, today);
  const actor = (item: (typeof activity)[number]) => (item.actor.id === session.user.id ? t("you") : item.actor.name ?? (item.actor.isMember ? t("aWorkspaceMember") : t("aFormerMember")));
  const describe = (item: (typeof activity)[number]) => {
    if (item.action === "opportunity.create") return t("activity.created", { actor: actor(item), stage: item.toStage ?? t("aStage") });
    if (item.action === "opportunity.move") return t("activity.moved", { actor: actor(item), from: item.fromStage ?? t("aStage"), to: item.toStage ?? t("aStage") });
    if (item.action === "opportunity.archive") return t("activity.archived", { actor: actor(item) });
    if (item.action === "opportunity.restore") return t("activity.restored", { actor: actor(item) });
    return t("activity.updated", { actor: actor(item), fields: format.list(item.fields.map((field) => (["name", "amount", "expectedCloseDate", "ownerUserId", "companyId", "contactId", "closedReason", "currency"].includes(field) ? t(`fieldNames.${field as "name"}`) : field)), { type: "conjunction" }) });
  };
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
        history={<Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><History className="size-4 text-muted-foreground" aria-hidden="true" />{t("activityTitle")}</CardTitle></CardHeader>
          <CardContent>{activity.length ? <ol className="space-y-3">{activity.map((item) => <li key={item.id} className="border-l-2 pl-3 text-sm">
            <p>{describe(item)}</p><time className="text-[11px] text-muted-foreground" dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, "dateTime")}</time>
          </li>)}</ol> : <Empty className="p-3 py-6 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><History aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">{t("noActivityYet")}</EmptyTitle><EmptyDescription>{t("noActivityYetHelp")}</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>} />
      {!deal.archivedAt && <div className="flex justify-end"><DealArchiveControl archived={false} board={board} /></div>}
    </div>
  </RecordProvider>;
}
