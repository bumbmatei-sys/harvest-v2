import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Building2, CalendarDays, FileText, SlidersHorizontal, UsersRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCompany } from "@/server/companies";
import { listCompanyActivity } from "@/server/activity";
import { getRecordCustomFields } from "@/server/crm-fields";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CompanyDescription, CompanyFields } from "@/components/crm/company-fields";
import { CompanyPeople } from "@/components/crm/company-people";
import { initials } from "@/components/crm/format";
import { PossibleDuplicates } from "@/components/crm/possible-duplicates";
import { CustomFields } from "@/components/crm/custom-fields";
import { RecordProvider } from "@/components/crm/record-context";
import { RecordTitle } from "@/components/crm/record-title";
import { RecordBackLink, RecordGrid, RecordHeader } from "@/components/crm/record-layout";
import { StaleNotice } from "@/components/crm/stale-notice";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("company") }) };
}

export default async function CompanyPage({ params }: { params: Promise<{ tenantId: string; companyId: string }> }) {
  const t = await getTranslations("Crm");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId, companyId } = await params;
  const back = `/workspaces/${tenantId}/crm/companies`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(companyId).success) return <AccessState missing kind="company" href={back} />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getCompany(getDb(), session.user.id, tenantId, companyId), listCompanyActivity(getDb(), session.user.id, tenantId, companyId), getRecordCustomFields(getDb(), session.user.id, tenantId, "company", companyId)])
    .catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} kind="company" href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, company, activity, custom] = result, writable = can(workspace.role, "companies:write");
  return <RecordProvider endpoint={`/api/workspaces/${tenantId}/companies/${companyId}`} version={company.version} writable={writable}>
    <div className="space-y-4">
      <RecordHeader back={<RecordBackLink href={back} label={t("allCompanies")} />}>
      <div className="flex min-w-0 flex-1 items-center gap-3.5">
        <Avatar className="size-12 rounded-xl border" aria-hidden="true"><AvatarFallback className="rounded-xl bg-selected text-lg font-medium">{initials(company.name)}</AvatarFallback></Avatar>
        <div className="min-w-0 flex-1">
          <RecordTitle field="name" value={company.name} label={t("fields.name")} maxLength={100} />
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><UsersRound className="size-3.5" aria-hidden="true" />{t("peopleCount", { count: company.people.length })}</span>
            <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{t("addedOn", { date: format.dateTime(company.createdAt, "date") })}</span>
          </p>
        </div>
      </div>
      </RecordHeader>
      {!writable && <Alert><AlertDescription>{t("viewOnlyRecord")}</AlertDescription></Alert>}
      <StaleNotice />
      <PossibleDuplicates kind="company" items={company.possibleDuplicates.map((item) => ({ id: item.id, name: item.name, href: `${back}/${item.id}`, hint: item.domain }))} />
      <RecordGrid contextWide
        profile={<>
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" />{t("details")}</CardTitle></CardHeader>
            <CardContent><CompanyFields domain={company.domain ?? ""} /></CardContent></Card>
          {(custom.definitions.length > 0 || can(workspace.role, "crm:fields_write")) && <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />{t("customFields")}</CardTitle></CardHeader>
            <CardContent><CustomFields fields={custom.definitions} values={custom.values} related={custom.related} tenantId={tenantId} manageHref={can(workspace.role, "crm:fields_write") ? `/workspaces/${tenantId}/crm/settings/fields?object=company` : null} /></CardContent></Card>}
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><FileText className="size-4 text-muted-foreground" aria-hidden="true" />{t("fields.description")}</CardTitle></CardHeader>
            <CardContent><CompanyDescription value={company.description} /></CardContent></Card>
        </>}
        context={<Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><UsersRound className="size-4 text-muted-foreground" aria-hidden="true" />{t("people")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(company.people.length, "integer")}</Badge></CardTitle></CardHeader>
            <CardContent><CompanyPeople tenantId={tenantId} company={{ id: company.id, name: company.name }} people={company.people} writable={can(workspace.role, "contacts:write")} /></CardContent></Card>}
        history={<Card className="gap-3"><CardHeader><CardTitle className="text-sm">{t("activityTab")}</CardTitle></CardHeader>
            <CardContent><ActivityTimeline items={activity} tenantId={tenantId} subject="company" currentUserId={session.user.id} customLabels={Object.fromEntries(custom.definitions.map((field) => [field.key, field.label]))} /></CardContent></Card>} />
    </div>
  </RecordProvider>;
}
