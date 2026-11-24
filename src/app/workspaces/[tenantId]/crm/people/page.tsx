import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { UsersRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listContacts } from "@/server/contacts";
import { resolveListView } from "@/server/crm-list-view";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { ContactForm } from "@/components/contact-form";
import { listParts } from "@/components/crm/list-parts";
import { personRows } from "@/components/crm/person-rows";
import { ListPage } from "@/components/crm/list-page";
import { ExportDialog } from "@/components/crm/export-dialog";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Upload } from "lucide-react";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("people") }) };
}

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
  const imports = await getTranslations("Imports");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const raw = await searchParams, db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const writable = can(workspace.role, "contacts:write");
  const resolved = await resolveListView(db, session.user.id, tenantId, "person", raw, writable, (query) => listContacts(db, session.user.id, tenantId, query))
    .catch((error: unknown) => { if (error instanceof AccessError && error.status !== 400) return null; throw error; });
  if (!resolved) return <AccessState />;
  const { list, views, current, viewId, notice, modified, query } = resolved;
  const parts = listParts(t, "person", list.definitions, list.state, views, can(workspace.role, "contacts:sources_read"));
  const rows = personRows({ t, format, tenantId, list, sourceAccess: can(workspace.role, "contacts:sources_read") });
  return <ListPage tenantId={tenantId} objectType="person" icon={UsersRound} title={t("people")} description={t("peopleDescription")} total={list.total} page={list.page}
    actions={<>{can(workspace.role, "crm:import") && <Button size="responsive" variant="outline" asChild><Link href={`/workspaces/${tenantId}/crm/imports?entity=person`}><Upload aria-hidden="true" />{imports("importAction")}</Link></Button>}
      {can(workspace.role, "crm:export") && <ExportDialog tenantId={tenantId} entity="person" query={query} listName={t("people")} disabled={Boolean(list.locked)} />}</>}
    create={<ContactForm tenantId={tenantId} />} viewOnly={writable ? null : t("viewOnlyPeople")} notice={notice} state={list.state} viewId={viewId} query={query}
    parts={parts} related={list.related} views={parts.summaries} current={parts.summaries.find((view) => view.id === current.id)!} modified={modified} writable={writable} rows={rows}
    sourceAccess={can(workspace.role, "contacts:sources_read")}
    copy={{ searchLabel: t("searchPeople"), searchPlaceholder: t("searchPeoplePlaceholder"), noMatch: t("noMatchingPeople"), pageEmpty: t("noPeopleOnThisPage"), emptyTitle: t("everyConnectionStartsSomewhere"), emptyDescription: t("addYourFirstPerson"), pages: t("peoplePages"), privacy: t("privacyNote") }} />;
}
