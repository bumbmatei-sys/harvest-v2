import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { ShieldCheck, UsersRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listContacts } from "@/server/contacts";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { peopleQuery, peopleSorts } from "@/lib/crm-input";
import { AccessState } from "@/components/access-state";
import { ContactForm } from "@/components/contact-form";
import { CompanyFilter } from "@/components/crm/company-filter";
import { initials } from "@/components/crm/format";
import { MarketingBadge } from "@/components/crm/marketing-badge";
import { RecordList, RecordResults, RecordToolbar } from "@/components/crm/record-list";
import { RecordPagination } from "@/components/crm/record-pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const viewKeys = ["q", "sort", "company", "email", "marketing"] as const;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("people") }) };
}

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const t = await getTranslations("Crm");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const raw = await searchParams;
  const parsed = peopleQuery.safeParse(raw);
  const query = parsed.success ? parsed.data : peopleQuery.parse({});
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), listContacts(getDb(), session.user.id, tenantId, query)]).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) return <AccessState />;
  const [workspace, list] = result;
  const writable = can(workspace.role, "contacts:write"), base = `/workspaces/${tenantId}/crm/people`;
  const view = Object.fromEntries(viewKeys.flatMap((key) => { const value = key === "q" ? list.q : key === "sort" ? (list.sort === "name" ? "" : list.sort) : list.filters[key]; return value ? [[key, value]] : []; })) as Record<string, string>;
  const filtered = Object.keys(view).some((key) => key !== "sort");
  const sortLabels = { name: t("sorts.nameAsc"), "-name": t("sorts.nameDesc"), "-created": t("sorts.newest"), created: t("sorts.oldest"), "-updated": t("sorts.recentlyUpdated") } satisfies Record<typeof peopleSorts[number], string>;
  const companyChip = list.filters.company && list.filters.company !== "any" && list.filters.company !== "none"
    ? [{ key: "company", label: t("filterChip", { filter: t("company"), value: list.filterCompany?.name ?? t("unavailableCompany") }) }] : [];
  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><UsersRound className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("people")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(list.total, "integer")}</Badge></h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("peopleDescription")}</p></div>
      {writable && <ContactForm tenantId={tenantId} />}
    </div>
    {!parsed.success && <Alert variant="destructive"><AlertDescription>{t("checkTheViewSettings")}</AlertDescription></Alert>}
    {!writable && <Alert><AlertDescription>{t("viewOnlyPeople")}</AlertDescription></Alert>}
    <RecordList params={view}>
      <RecordToolbar searchLabel={t("searchPeople")} searchPlaceholder={t("searchPeoplePlaceholder")} defaultSort="name" chips={companyChip}
        sorts={peopleSorts.map((value) => ({ value, label: sortLabels[value] }))}
        filters={[
          { key: "company", label: t("company"), options: [{ value: "any", label: t("hasACompany") }, { value: "none", label: t("noCompany") }] },
          { key: "email", label: t("email"), options: [{ value: "with", label: t("hasEmail") }, { value: "without", label: t("noEmail") }] },
          { key: "marketing", label: t("emailMarketing"), options: [{ value: "granted", label: t("marketing.granted") }, { value: "withdrawn", label: t("marketing.withdrawn") }, { value: "none", label: t("marketing.none") }] },
        ]}
        extraFilter={<CompanyFilter tenantId={tenantId} />} />
      <div className="mt-3 space-y-3"><RecordResults>
        {/* Columns respond to the card's own width (container queries), not the viewport:
            the sidebar state changes the space available. The fixed layout makes the
            secondary columns exact and lets Name absorb the rest and truncate. */}
        {list.rows.length ? <Card className="@container gap-0 overflow-hidden py-0"><Table aria-label={t("people")} className="table-fixed">
          <TableHeader><TableRow>
            <TableHead className="pl-4">{t("name")}</TableHead><TableHead className="hidden w-48 @xl:table-cell">{t("company")}</TableHead>
            <TableHead className="hidden w-56 @2xl:table-cell">{t("email")}</TableHead><TableHead className="hidden w-36 @7xl:table-cell">{t("phone")}</TableHead>
            <TableHead className="hidden w-34 @4xl:table-cell">{t("emailMarketing")}</TableHead><TableHead className="hidden w-28 pr-4 @5xl:table-cell">{t("added")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>{list.rows.map((person) => {
            const email = person.identifiers.find((item) => item.kind === "email")?.value, phone = person.identifiers.find((item) => item.kind === "phone")?.value;
            const [primary, ...others] = person.companies;
            return <TableRow key={person.id} className="h-12">
              <TableCell className="overflow-hidden py-1.5 pl-4">
                <Link href={`${base}/${person.id}`} className="flex min-w-0 items-center gap-3 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="size-8" aria-hidden="true"><AvatarFallback className="text-xs text-muted-foreground">{initials(person.name)}</AvatarFallback></Avatar>
                  <span className="min-w-0"><span className="block truncate">{person.name}</span><span className="block truncate text-xs font-normal text-muted-foreground @xl:hidden">{primary?.name ?? email ?? t("notProvided")}</span></span>
                </Link></TableCell>
              <TableCell className="hidden overflow-hidden text-xs @xl:table-cell">{primary ? <span className="flex min-w-0 items-center gap-1.5"><Link href={`/workspaces/${tenantId}/crm/companies/${primary.companyId}`} className="truncate rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{primary.name}</Link>{others.length > 0 && <Badge variant="outline" className="h-5 shrink-0 rounded-md px-1.5 text-[11px] font-normal" title={others.map((item) => item.name).join(", ")}>{t("moreCount", { count: others.length })}</Badge>}</span> : <span className="text-muted-foreground">{t("noCompany")}</span>}</TableCell>
              <TableCell className="hidden truncate text-xs text-muted-foreground @2xl:table-cell">{email ?? t("notProvided")}</TableCell>
              <TableCell className="hidden truncate text-xs text-muted-foreground tabular-nums @7xl:table-cell">{phone ?? t("notProvided")}</TableCell>
              <TableCell className="hidden overflow-hidden @4xl:table-cell"><MarketingBadge state={person.marketingEmail} /></TableCell>
              <TableCell className="hidden truncate pr-4 text-xs text-muted-foreground @5xl:table-cell">{format.dateTime(person.createdAt, "date")}</TableCell>
            </TableRow>;
          })}</TableBody>
        </Table></Card> : <Empty className="min-h-[280px] border border-solid bg-card p-7 sm:p-10">
          <EmptyHeader><EmptyMedia variant="icon"><UsersRound aria-hidden="true" /></EmptyMedia>
            <EmptyTitle><h2>{filtered ? t("noMatchingPeople") : list.page > 1 ? t("noPeopleOnThisPage") : t("everyConnectionStartsSomewhere")}</h2></EmptyTitle>
            <EmptyDescription>{filtered ? t("tryAnotherSearchOrRemoveFilters") : list.page > 1 ? t("returnToTheFirstPage") : t("addYourFirstPerson")}</EmptyDescription></EmptyHeader>
          <EmptyContent>{filtered || list.page > 1 ? <Button variant="outline" asChild><Link href={base}>{t("resetView")}</Link></Button> : writable && <ContactForm tenantId={tenantId} />}</EmptyContent>
        </Empty>}
      </RecordResults>
      <RecordPagination base={base} params={view} page={list.page} total={list.total} label={t("peoplePages")} /></div>
    </RecordList>
    <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{t("privacyNote")}</p>
  </div>;
}
