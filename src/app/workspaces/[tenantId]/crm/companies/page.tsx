import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listCompanies } from "@/server/companies";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { companyQuery, companySorts } from "@/lib/crm-input";
import { AccessState } from "@/components/access-state";
import { CompanyForm } from "@/components/crm/company-form";
import { initials } from "@/components/crm/format";
import { RecordList, RecordResults, RecordToolbar } from "@/components/crm/record-list";
import { RecordPagination } from "@/components/crm/record-pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const viewKeys = ["q", "sort", "people", "domain"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("companies") }) };
}

export default async function CompaniesPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const parsed = companyQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : companyQuery.parse({});
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), listCompanies(getDb(), session.user.id, tenantId, query)]).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) return <AccessState />;
  const [workspace, list] = result;
  const writable = can(workspace.role, "companies:write"), base = `/workspaces/${tenantId}/crm/companies`;
  const view = Object.fromEntries(viewKeys.flatMap((key) => { const value = key === "q" ? list.q : key === "sort" ? (list.sort === "name" ? "" : list.sort) : list.filters[key]; return value ? [[key, value]] : []; })) as Record<string, string>;
  const filtered = Object.keys(view).some((key) => key !== "sort");
  const sortLabels = { name: t("sorts.nameAsc"), "-name": t("sorts.nameDesc"), "-created": t("sorts.newest"), created: t("sorts.oldest"), "-people": t("sorts.mostPeople") } satisfies Record<typeof companySorts[number], string>;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Building2 className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("companies")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(list.total, "integer")}</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("companiesDescription")}</p></div>
      {writable && <CompanyForm tenantId={tenantId} />}
    </div>
    {!parsed.success && <Alert variant="destructive"><AlertDescription>{t("checkTheViewSettings")}</AlertDescription></Alert>}
    {!writable && <Alert><AlertDescription>{t("viewOnlyCompanies")}</AlertDescription></Alert>}
    <RecordList params={view}>
      <RecordToolbar searchLabel={t("searchCompanies")} searchPlaceholder={t("searchCompaniesPlaceholder")} defaultSort="name"
        sorts={companySorts.map((value) => ({ value, label: sortLabels[value] }))}
        filters={[
          { key: "people", label: t("people"), options: [{ value: "any", label: t("hasPeople") }, { value: "none", label: t("noPeople") }] },
          { key: "domain", label: t("fields.domain"), options: [{ value: "with", label: t("hasDomain") }, { value: "without", label: t("noDomain") }] },
        ]} />
      <div className="mt-3 space-y-3"><RecordResults>
        {/* Same responsive model as People: container queries plus a fixed layout. */}
        {list.rows.length ? <Card className="@container gap-0 overflow-hidden py-0"><Table aria-label={t("companies")} className="table-fixed">
          <TableHeader><TableRow><TableHead className="pl-4">{t("name")}</TableHead><TableHead className="hidden w-60 @xl:table-cell">{t("fields.domain")}</TableHead><TableHead className="w-22 text-right @xl:text-left">{t("people")}</TableHead><TableHead className="hidden w-28 pr-4 @3xl:table-cell">{t("added")}</TableHead></TableRow></TableHeader>
          <TableBody>{list.rows.map((company) => <TableRow key={company.id} className="h-12">
            <TableCell className="overflow-hidden py-1.5 pl-4"><Link href={`${base}/${company.id}`} className="flex min-w-0 items-center gap-3 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="size-8 rounded-md" aria-hidden="true"><AvatarFallback className="rounded-md text-xs text-muted-foreground">{initials(company.name)}</AvatarFallback></Avatar>
              <span className="min-w-0"><span className="block truncate">{company.name}</span><span className="block truncate text-xs font-normal text-muted-foreground @xl:hidden">{company.domain ?? t("noDomain")}</span></span></Link></TableCell>
            {/* The domain anchor is bounded and truncates (full domain in its title); its focus ring is inset so the cell can never clip it. */}
            <TableCell className="hidden truncate text-xs @xl:table-cell">{company.domain ? <a href={`https://${company.domain}`} target="_blank" rel="noreferrer" title={company.domain} className="-mx-1 block max-w-full truncate rounded-sm px-1 py-0.5 text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">{company.domain}</a> : <span className="text-muted-foreground">{t("noDomain")}</span>}</TableCell>
            <TableCell className="truncate text-right text-xs tabular-nums @xl:text-left"><Link href={`/workspaces/${tenantId}/crm/people?company=${company.id}`} className="rounded-sm text-muted-foreground hover:text-foreground hover:underline" aria-label={t("viewPeopleAtCompany", { count: company.peopleCount, company: company.name })}>{format.number(company.peopleCount, "integer")}</Link></TableCell>
            <TableCell className="hidden truncate pr-4 text-xs text-muted-foreground @3xl:table-cell">{format.dateTime(company.createdAt, "date")}</TableCell>
          </TableRow>)}</TableBody>
        </Table></Card> : <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
          <EmptyHeader><EmptyMedia variant="icon"><Building2 aria-hidden="true" /></EmptyMedia>
            <EmptyTitle><h2>{filtered ? t("noMatchingCompanies") : list.page > 1 ? t("noCompaniesOnThisPage") : t("noCompaniesYet")}</h2></EmptyTitle>
            <EmptyDescription>{filtered ? t("tryAnotherSearchOrRemoveFilters") : list.page > 1 ? t("returnToTheFirstPage") : t("addYourFirstCompany")}</EmptyDescription></EmptyHeader>
          <EmptyContent>{filtered || list.page > 1 ? <Button variant="outline" asChild><Link href={base}>{t("resetView")}</Link></Button> : writable && <CompanyForm tenantId={tenantId} />}</EmptyContent>
        </Empty>}
      </RecordResults>
      <RecordPagination base={base} params={view} page={list.page} total={list.total} label={t("companyPages")} /></div>
    </RecordList>
    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{t("companiesPrivacyNote")}</p>
  </div>;
}
