/** Derived from Shadcn UI Kit item chat-ui4 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 6). Visual reference only; local changes: docs/ui-sources.md. */
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { CalendarDays, Link2, ListChecks, LockKeyhole, SearchX, ShieldCheck, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getFollowUpCase } from "@/server/follow-up-cases";
import { listAssignableMembers } from "@/server/follow-up-members";
import { getContact } from "@/server/contacts";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { consentControls } from "@/lib/consent-controls";
import { canOpenFollowUp, caseActions, caseEvents, caseReference, caseTracker, followUpTone } from "@/lib/follow-up-ui";
import { AccessState } from "@/components/access-state";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { StatusTracker } from "@/components/status-tracker";
import { RecordBackLink, RecordGrid, RecordHeader } from "@/components/crm/record-layout";
import { FollowUpConsent } from "@/components/connect-admin/follow-up-consent";
import { FollowUpCaseActions } from "@/components/connect-admin/follow-up-case-actions";
import { FollowUpTimeline } from "@/components/connect-admin/follow-up-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("FollowUp");
  return { title: t("caseTitle") };
}

/**
 * One follow-up case. The case holds no name or contact detail, so the person is reached through the CRM link, which applies CRM
 * permissions itself. Controls are shown by role and state (see caseActions); the server remains the enforcement.
 */
export default async function FollowUpCasePage({ params }: { params: Promise<{ tenantId: string; caseId: string }> }) {
  const t = await getTranslations("FollowUp");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId, caseId } = await params;
  const back = `/workspaces/${tenantId}/connect/follow-up`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(caseId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !canOpenFollowUp(workspace.role)) return <AccessState />;
  const found = await getFollowUpCase(db, session.user.id, tenantId, caseId).then((item) => ({ item }), (error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if ("status" in found) {
    return <EmptyState solid icon={found.status === 404 ? SearchX : LockKeyhole} title={t(found.status === 404 ? "caseNotFound" : "caseDenied")} headingLevel={2}
      action={<Button asChild variant="outline" size="responsive"><Link href={back}>{t("backToQueue")}</Link></Button>} />;
  }
  const { item } = found;
  const assignedToViewer = item.assigneeId === session.user.id;
  const actions = caseActions(workspace.role, item.state, assignedToViewer), controls = consentControls(workspace.role);
  const members = await listAssignableMembers(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return []; throw error; });
  // Only the follow-up consent rows are read; the contact's name and details are never shown here (the CRM page owns that, with its own permissions).
  const consent = await getContact(db, session.user.id, tenantId, item.contactId).then((contact) => contact.effectiveConsents.filter((event) => event.purpose === "outreach_follow_up")
    .map((event) => ({ channel: event.channel, status: event.status, occurredAt: event.occurredAt, source: event.source })), (error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  const assigneeName = item.assigneeId === null ? null : assignedToViewer ? t("you") : members.find((member) => member.id === item.assigneeId)?.name ?? t("anotherMember");
  const tracker = caseTracker(item.state), steps = tracker.steps.map((step) => ({ id: step.id, label: t(`states.${step.id}`) }));
  const hasActions = actions.assign || actions.unassign || actions.moves.length > 0;
  const reference = t("caseNumber", { reference: caseReference(item.id) });
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => <div className="flex items-center justify-between gap-3 text-sm"><dt className="flex items-center gap-2 text-muted-foreground">{icon}{label}</dt><dd className="min-w-0 text-right break-words">{value}</dd></div>;
  return <div className="space-y-4">
    <RecordHeader back={<RecordBackLink href={back} label={t("backToQueue")} />}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{reference}</h1><StatusBadge tone={followUpTone(item.state)} label={t(`states.${item.state}`)} dot /></div>
    </RecordHeader>
    <StatusTracker steps={steps} current={item.state} label={t("trackerLabel")} tone={tracker.tone} />
    <RecordGrid
      profile={<Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ListChecks className="size-4 text-muted-foreground" aria-hidden="true" /><h2>{t("details")}</h2></CardTitle></CardHeader>
        <CardContent><dl className="space-y-3">
          {row(<UserRound className="size-4" aria-hidden="true" />, t("columns.contact"), <Link href={`/workspaces/${tenantId}/crm/people/${item.contactId}`} className="inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline lg:min-h-0"><Link2 className="size-4" aria-hidden="true" />{t("openContact")}</Link>)}
          {row(<UserRound className="size-4" aria-hidden="true" />, t("columns.assignee"), assigneeName ?? t("unassigned"))}
          {row(<CalendarDays className="size-4" aria-hidden="true" />, t("opened"), <time dateTime={item.createdAt.toISOString()}>{format.dateTime(item.createdAt, "dateTime")}</time>)}
          {row(<CalendarDays className="size-4" aria-hidden="true" />, t("columns.updated"), <time dateTime={item.stateChangedAt.toISOString()}>{format.dateTime(item.stateChangedAt, "dateTime")}</time>)}
        </dl></CardContent></Card>}
      context={<>
        {hasActions && <Card className="gap-3"><CardHeader><CardTitle className="text-sm"><h2>{t("actions")}</h2></CardTitle></CardHeader>
          <CardContent><FollowUpCaseActions tenantId={tenantId} caseId={item.id} version={item.version} assigneeId={item.assigneeId} currentUserId={session.user.id} members={members} actions={actions} /></CardContent></Card>}
        {consent && <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" /><h2>{t("consentTitle")}</h2></CardTitle></CardHeader>
          <CardContent><FollowUpConsent tenantId={tenantId} contactId={item.contactId} events={consent} canGrant={controls.canGrant} canWithdraw={controls.canWithdraw} /></CardContent></Card>}
      </>}
      history={<Card className="gap-3"><CardHeader><CardTitle className="text-sm"><h2>{t("timeline")}</h2></CardTitle></CardHeader>
        <CardContent><FollowUpTimeline events={caseEvents(item)} assignee={assigneeName} /></CardContent></Card>} />
  </div>;
}
