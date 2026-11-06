import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Building2 } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCompanies } from "@/server/companies";
import { resolveListView } from "@/server/crm-list-view";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { customFieldKey, serializeFilter } from "@/lib/crm-fields";
import { AccessState } from "@/components/access-state";
import { CompanyForm } from "@/components/crm/company-form";
import { customCell, listParts } from "@/components/crm/list-parts";
import { ListPage } from "@/components/crm/list-page";
import { ExportDialog } from "@/components/crm/export-dialog";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Upload } from "lucide-react";
import type { GridRow } from "@/components/crm/record-grid";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("companies") }) };
}

export default async function CompaniesPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
  const imports = await getTranslations("Imports");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const raw = await searchParams, db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  const writable = can(workspace.role, "companies:write");
  const resolved = await resolveListView(db, session.user.id, tenantId, "company", raw, writable, (query) => listCompanies(db, session.user.id, tenantId, query))
    .catch((error: unknown) => { if (error instanceof AccessError && error.status !== 400) return null; throw error; });
  if (!resolved) return <AccessState />;
  const { list, views, current, viewId, notice, modified, query } = resolved;
  const parts = listParts(t, "company", list.definitions, list.state, views);
  const people = `/workspaces/${tenantId}/crm/people`, companies = `/workspaces/${tenantId}/crm/companies`;
  const rows: GridRow[] = list.rows.map((company) => {
    const cells: GridRow["cells"] = {
      domain: company.domain ? { text: company.domain, href: `https://${company.domain}`, external: true, muted: true, edit: { kind: "text", value: company.domain, target: "builtin", field: "domain", maxLength: 253 } }
        : { text: t("noDomain"), muted: true, edit: { kind: "text", value: "", target: "builtin", field: "domain", maxLength: 253 } },
      people: { text: format.number(company.peopleCount, "integer"), muted: true, href: `${people}?${new URLSearchParams({ f: serializeFilter({ field: "company", op: "is", value: company.id }) })}`, label: t("viewPeopleAtCompany", { count: company.peopleCount, company: company.name }) },
      created: { text: format.dateTime(company.createdAt, "date"), muted: true },
      updated: { text: format.dateTime(company.updatedAt, "date"), muted: true },
    };
    for (const field of list.definitions) cells[customFieldKey(field.key)] = customCell(t, format, tenantId, field, company.custom[field.key], list.related);
    return { id: company.id, version: company.version, name: company.name, href: `${companies}/${company.id}`, secondary: company.domain ?? t("noDomain"), cells };
  });
  return <ListPage tenantId={tenantId} objectType="company" icon={Building2} title={t("companies")} description={t("companiesDescription")} total={list.total} page={list.page}
    actions={<>{can(workspace.role, "crm:import") && <Button variant="outline" asChild><Link href={`/workspaces/${tenantId}/crm/imports?entity=company`}><Upload aria-hidden="true" />{imports("importAction")}</Link></Button>}
      {can(workspace.role, "crm:export") && <ExportDialog tenantId={tenantId} entity="company" query={query} listName={t("companies")} />}</>}
    create={<CompanyForm tenantId={tenantId} />} viewOnly={writable ? null : t("viewOnlyCompanies")} notice={notice} state={list.state} viewId={viewId} query={query}
    parts={parts} related={list.related} views={parts.summaries} current={parts.summaries.find((view) => view.id === current.id)!} modified={modified} writable={writable} rows={rows}
    copy={{ searchLabel: t("searchCompanies"), searchPlaceholder: t("searchCompaniesPlaceholder"), noMatch: t("noMatchingCompanies"), pageEmpty: t("noCompaniesOnThisPage"), emptyTitle: t("noCompaniesYet"), emptyDescription: t("addYourFirstCompany"), pages: t("companyPages"), privacy: t("companiesPrivacyNote") }} />;
}
