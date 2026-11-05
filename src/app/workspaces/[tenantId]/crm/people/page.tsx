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
import { customFieldKey } from "@/lib/crm-fields";
import { AccessState } from "@/components/access-state";
import { ContactForm } from "@/components/contact-form";
import { customCell, listParts } from "@/components/crm/list-parts";
import { ListPage } from "@/components/crm/list-page";
import type { GridRow } from "@/components/crm/record-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("people") }) };
}

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
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
  const parts = listParts(t, "person", list.definitions, list.state, views);
  const people = `/workspaces/${tenantId}/crm/people`, companies = `/workspaces/${tenantId}/crm/companies`;
  const rows: GridRow[] = list.rows.map((person) => {
    const email = person.identifiers.find((item) => item.kind === "email")?.value, phone = person.identifiers.find((item) => item.kind === "phone")?.value;
    const [primary, ...others] = person.companies;
    const cells: GridRow["cells"] = {
      company: primary ? { text: primary.name, href: `${companies}/${primary.companyId}`, more: others.length, title: [primary, ...others].map((item) => item.name).join(", ") } : { text: t("noCompany"), muted: true },
      email: { text: email ?? t("notProvided"), muted: true, edit: { kind: "email", value: email ?? "", target: "builtin", field: "email", maxLength: 254 } },
      phone: { text: phone ?? t("notProvided"), muted: true, edit: { kind: "tel", value: phone ?? "", target: "builtin", field: "phone", maxLength: 40 } },
      marketing: { text: t(`marketing.${person.marketingEmail}`), badge: person.marketingEmail },
      created: { text: format.dateTime(person.createdAt, "date"), muted: true },
      updated: { text: format.dateTime(person.updatedAt, "date"), muted: true },
    };
    for (const field of list.definitions) cells[customFieldKey(field.key)] = customCell(t, format, tenantId, field, person.custom[field.key], list.related);
    return { id: person.id, version: person.version, name: person.name, href: `${people}/${person.id}`, secondary: primary?.name ?? email ?? t("notProvided"), cells };
  });
  return <ListPage tenantId={tenantId} objectType="person" icon={UsersRound} title={t("people")} description={t("peopleDescription")} total={list.total} page={list.page}
    create={<ContactForm tenantId={tenantId} />} viewOnly={writable ? null : t("viewOnlyPeople")} notice={notice} state={list.state} viewId={viewId} query={query}
    parts={parts} related={list.related} views={parts.summaries} current={parts.summaries.find((view) => view.id === current.id)!} modified={modified} writable={writable} rows={rows}
    copy={{ searchLabel: t("searchPeople"), searchPlaceholder: t("searchPeoplePlaceholder"), noMatch: t("noMatchingPeople"), pageEmpty: t("noPeopleOnThisPage"), emptyTitle: t("everyConnectionStartsSomewhere"), emptyDescription: t("addYourFirstPerson"), pages: t("peoplePages"), privacy: t("privacyNote") }} />;
}
