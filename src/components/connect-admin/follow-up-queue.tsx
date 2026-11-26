/** Derived from Shadcn UI Kit item tables15 (premium), registry retrieved 2026-11-16, approved 2026-11-16 (Kit PR 6). Visual reference only; local changes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { HeartHandshake } from "lucide-react";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import type { FollowUpCaseState } from "@/lib/follow-up-cases";
import { caseReference, followUpTone, queueHref, type QueueTab } from "@/lib/follow-up-ui";

export type QueueRow = { id: string; state: FollowUpCaseState; contactId: string; assigneeId: string | null; stateChangedAt: string };

const link = "inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline lg:min-h-0";

/**
 * The follow-up queue: a state filter, one row per case (cards on phones) and cursor paging. Everything shown is an id, a state or a
 * timestamp the case API returned; the person is reached through the CRM link, which enforces its own permissions. No totals: the server
 * returns none, so the tabs carry no counts. Which cases appear is decided by the database policy, never by this component.
 */
export function FollowUpQueue({ tenantId, rows, tabs, state, campaign, nextCursor, hasCursor, currentUserId, members, manage }: {
  tenantId: string; rows: QueueRow[]; tabs: QueueTab[]; state: QueueTab; campaign?: string; nextCursor: string | null; hasCursor: boolean;
  currentUserId: string; members: { id: string; name: string }[]; manage: boolean;
}) {
  const t = useTranslations("FollowUp");
  const format = useFormatter();
  const router = useRouter();
  const base = `/workspaces/${tenantId}/connect/follow-up`;
  const names = new Map(members.map((member) => [member.id, member.name]));
  const assignee = (id: string | null) => id === null ? t("unassigned") : id === currentUserId ? t("you") : names.get(id) ?? t("anotherMember");
  const columns: DataTableColumn[] = [
    { id: "case", header: t("columns.case"), card: "title" },
    { id: "state", header: t("columns.state") },
    { id: "contact", header: t("columns.contact"), showFrom: "@md" },
    { id: "assignee", header: t("columns.assignee"), showFrom: "@lg" },
    { id: "updated", header: t("columns.updated"), showFrom: "@lg" },
  ];
  const tableRows: DataTableRow[] = rows.map((row) => ({ id: row.id, label: t("caseNumber", { reference: caseReference(row.id) }), cells: {
    case: <Link className={link} href={`${base}/${row.id}`}>{t("caseNumber", { reference: caseReference(row.id) })}</Link>,
    state: <StatusBadge tone={followUpTone(row.state)} label={t(`states.${row.state}`)} dot />,
    contact: <Link className={link} href={`/workspaces/${tenantId}/crm/people/${row.contactId}`}>{t("openContact")}</Link>,
    assignee: assignee(row.assigneeId),
    updated: <time dateTime={row.stateChangedAt}>{format.dateTime(new Date(row.stateChangedAt), "date")}</time>,
  } }));
  const filtered = state !== "all" || campaign !== undefined;
  const empty = <EmptyState icon={HeartHandshake} title={filtered ? t("emptyFiltered") : manage ? t("emptyManage") : t("emptyMember")}
    description={filtered ? undefined : manage ? t("emptyManageHelp") : undefined}
    action={filtered ? <Button asChild variant="outline" size="responsive"><Link href={base}>{t("showAll")}</Link></Button> : undefined} />;
  const pagination = nextCursor || hasCursor ? <nav aria-label={t("pages")} className="flex flex-wrap items-center justify-between gap-2">
    {hasCursor ? <Button asChild variant="outline" size="responsive"><Link href={queueHref(base, { state, campaign })}>{t("firstPage")}</Link></Button> : <span />}
    {nextCursor ? <Button asChild variant="outline" size="responsive"><Link href={queueHref(base, { state, campaign, cursor: nextCursor })}>{t("nextPage")}</Link></Button> : null}
  </nav> : undefined;
  const table = <DataTable label={t("queueLabel")} columns={columns} rows={tableRows} empty={empty} pagination={pagination}
    tabs={{ label: t("filterByState"), value: state, onValueChange: (value) => router.push(queueHref(base, { state: value as QueueTab, campaign })), items: tabs.map((value) => ({ value, label: t(value === "all" ? "tabs.all" : `states.${value}`) })) }} />;
  if (!campaign) return table;
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted-foreground">{t("campaignFilter")}</span>
      <Button asChild variant="outline" size="responsive"><Link href={queueHref(base, { state })}>{t("allCampaigns")}</Link></Button></div>
    {table}
  </div>;
}
