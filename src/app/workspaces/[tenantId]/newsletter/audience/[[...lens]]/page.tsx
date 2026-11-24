import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ContactRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { audienceOverview, audienceStatuses, listAudiencePeople, type AudienceLens, type AudienceStatus } from "@/server/newsletter-audience";
import { resolveListView } from "@/server/crm-list-view";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { consentTone } from "@/lib/crm-consent-tone";
import { AccessState } from "@/components/access-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { listParts } from "@/components/crm/list-parts";
import { ListPage } from "@/components/crm/list-page";
import { personRows } from "@/components/crm/person-rows";
import { AudienceLens as LensStrip } from "@/components/newsletter/audience-lens";
import { AddToListButton, NewListButton, SaveGroupButton } from "@/components/newsletter/audience-actions";
import Link from "next/link";
import { Upload } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterAudience");
  return { title: t("pageTitle") };
}

function parseLens(segments: string[] | undefined): AudienceLens | null {
  const [first, second, ...rest] = segments ?? [];
  if (rest.length) return null;
  if (!first) return { kind: "all" };
  if ((audienceStatuses as readonly string[]).includes(first) && !second) return { kind: "status", status: first as AudienceStatus };
  if ((first === "list" || first === "group") && second && uuidInput.safeParse(second).success) return { kind: first, id: second };
  return null;
}
const lensKey = (lens: AudienceLens) => lens.kind === "all" ? "all" : lens.kind === "status" ? lens.status : `${lens.kind}:${lens.id}`;
const statusTone = { subscribed: "granted", not_on_list: "none", unsubscribed: "withdrawn", never: "none", suppressed: "withdrawn" } as const;

export default async function AudiencePage({ params, searchParams }: { params: Promise<{ tenantId: string; lens?: string[] }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterAudience"), crm = await getTranslations("Crm"), imports = await getTranslations("Imports"), format = await getFormatter();
  const session = await pageSession(), { tenantId, lens: segments } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const lens = parseLens(segments);
  if (!lens) notFound();
  const raw = await searchParams, db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:read")) return <Alert><AlertDescription>{t("noAccess")}</AlertDescription></Alert>;
  const manage = can(workspace.role, "newsletter:manage"), writable = can(workspace.role, "contacts:write");
  const overview = await audienceOverview(db, session.user.id, tenantId);
  if (lens.kind === "list" && !overview.lists.some((list) => list.id === lens.id)) notFound();
  if (lens.kind === "group" && !overview.groups.some((group) => group.id === lens.id)) notFound();
  const resolved = await resolveListView(db, session.user.id, tenantId, "person", raw, writable, (query) => listAudiencePeople(db, session.user.id, tenantId, query, lens))
    .catch((error: unknown) => { if (error instanceof AccessError && error.status !== 400) return null; throw error; });
  if (!resolved) return <AccessState />;
  const { list, views, current, viewId, notice, modified, query } = resolved;
  const sourceAccess = can(workspace.role, "contacts:sources_read");
  const parts = listParts(crm, "person", list.definitions, list.state, views, sourceAccess);
  const rows = personRows({ t: crm, format, tenantId, list, sourceAccess });
  const listLens = lens.kind === "list" ? lens : null;
  // Newsletter columns come first: the derived status, then (inside a list) this person's own membership.
  const statusOf = (row: (typeof list.rows)[number]) => (row.extra?.audienceStatus ?? "never") as AudienceStatus;
  rows.forEach((row, index) => {
    const person = list.rows[index], status = statusOf(person);
    row.cells.newsletter = { text: t(`status.${status}`), badge: statusTone[status] };
    if (row.summary) row.summary = { ...row.summary, status: { text: t(`status.${status}`), tone: consentTone(statusTone[status]) } };
    if (listLens) {
      const state = String(person.extra?.listState ?? ""), subscriberId = person.extra?.subscriberId ? String(person.extra.subscriberId) : null;
      row.cells.membership = { text: state ? t(`membership.${state as "subscribed"}`) : "", muted: state !== "subscribed",
        ...(manage && state === "subscribed" && subscriberId ? { action: { label: t("removeFromList", { name: person.name }), url: `/api/workspaces/${tenantId}/newsletter/audience/lists/${listLens.id}/people`, method: "DELETE" as const, body: { subscriberId, version: Number(person.extra?.subscriptionVersion) } } } : {}) };
    }
  });
  const gridColumns = [{ key: "newsletter", label: t("newsletterColumn"), width: 150 }, ...(listLens ? [{ key: "membership", label: t("membershipColumn"), width: 150 }] : []), ...parts.gridColumns];
  const title = lens.kind === "list" ? overview.lists.find((l) => l.id === lens.id)!.name : lens.kind === "group" ? overview.groups.find((g) => g.id === lens.id)!.name : t(`status.${lens.kind === "status" ? lens.status : "all"}`);
  const path = `/workspaces/${tenantId}/newsletter/audience${lens.kind === "all" ? "" : lens.kind === "status" ? `/${lens.status}` : `/${lens.kind}/${lens.id}`}`;
  return <ListPage tenantId={tenantId} objectType="person" icon={ContactRound} eyebrow={t("heading")} title={title} description="" total={list.total} page={list.page}
    basePath={path}
    lens={<LensStrip tenantId={tenantId} counts={overview.counts} lists={overview.lists} groups={overview.groups} current={lensKey(lens)} canManage={manage} />}
    toolbarExtra={manage ? <>{listLens && <AddToListButton tenantId={tenantId} listId={listLens.id} />}<NewListButton tenantId={tenantId} /><SaveGroupButton tenantId={tenantId} /></> : null}
    actions={can(workspace.role, "crm:import") ? <Button size="responsive" variant="outline" asChild><Link href={`/workspaces/${tenantId}/crm/imports?entity=person`}><Upload aria-hidden="true" />{imports("importAction")}</Link></Button> : undefined}
    create={null} viewOnly={manage ? null : t("viewOnly")} notice={notice} state={list.state} viewId={viewId} query={query}
    parts={{ ...parts, gridColumns }} related={list.related} views={parts.summaries} current={parts.summaries.find((view) => view.id === current.id)!} modified={modified} writable={manage || writable} rows={rows}
    sourceAccess={false}
    copy={{ searchLabel: crm("searchPeople"), searchPlaceholder: crm("searchPeoplePlaceholder"), noMatch: crm("noMatchingPeople"), pageEmpty: crm("noPeopleOnThisPage"), emptyTitle: t("emptyTitle"), emptyDescription: t("emptyDescription"), pages: crm("peoplePages"), privacy: t("privacy") }} />;
}
