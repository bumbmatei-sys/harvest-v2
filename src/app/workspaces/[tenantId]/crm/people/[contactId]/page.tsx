import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { AtSign, Building2, CalendarDays, Mail, Phone, ShieldCheck, SlidersHorizontal, StickyNote, UserRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getContact } from "@/server/contacts";
import { listContactActivity } from "@/server/activity";
import { getRecordCustomFields } from "@/server/crm-fields";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import type { ConsentLabel } from "@/lib/consent-labels";
import { AccessState } from "@/components/access-state";
import { ConsentForm } from "@/components/consent-form";
import { EraseContact } from "@/components/erase-contact";
import { ActivityTimeline } from "@/components/crm/activity-timeline";
import { CompanyLinks } from "@/components/crm/company-links";
import { ContactFields, ContactNotes } from "@/components/crm/contact-fields";
import { StaleNotice } from "@/components/crm/stale-notice";
import { initials } from "@/components/crm/format";
import { PossibleDuplicates } from "@/components/crm/possible-duplicates";
import { CustomFields } from "@/components/crm/custom-fields";
import { RecordProvider } from "@/components/crm/record-context";
import { RecordTitle } from "@/components/crm/record-title";
import { RecordBackLink, RecordGrid, RecordHeader } from "@/components/crm/record-layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemContent, ItemGroup, ItemHeader, ItemTitle } from "@/components/ui/item";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Crm");
  return { title: t("pageTitle", { page: t("person") }) };
}

export default async function PersonPage({ params }: { params: Promise<{ tenantId: string; contactId: string }> }) {
  const t = await getTranslations("Crm");
  const old = await getTranslations("AppWorkspacesContactsPage");
  const labels = await getTranslations("ConsentLabels");
  const format = await getFormatter();
  const session = await pageSession(), { tenantId, contactId } = await params;
  const back = `/workspaces/${tenantId}/crm/people`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(contactId).success) return <AccessState missing href={back} />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getContact(getDb(), session.user.id, tenantId, contactId), listContactActivity(getDb(), session.user.id, tenantId, contactId), getRecordCustomFields(getDb(), session.user.id, tenantId, "person", contactId)])
    .catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, contact, activity, custom] = result, writable = can(workspace.role, "contacts:write");
  const value = (kind: "email" | "phone" | "social") => contact.identifiers.find((item) => item.kind === kind)?.value ?? "";
  const primary = contact.companies.find((item) => item.isPrimary);
  return <RecordProvider endpoint={`/api/workspaces/${tenantId}/contacts/${contactId}`} version={contact.version} writable={writable}>
    <div className="space-y-4">
      <RecordHeader back={<RecordBackLink href={back} label={t("allPeople")} />}>
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <Avatar className="size-12 border" aria-hidden="true"><AvatarFallback className="bg-selected text-lg font-medium">{initials(contact.name)}</AvatarFallback></Avatar>
          <div className="min-w-0 flex-1">
            <RecordTitle field="name" value={contact.name} label={t("fields.name")} maxLength={100} />
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {primary && <Link href={`/workspaces/${tenantId}/crm/companies/${primary.companyId}`} className="flex items-center gap-1.5 hover:underline"><Building2 className="size-3.5" aria-hidden="true" />{primary.title ? t("roleAt", { role: primary.title, company: primary.name }) : primary.name}</Link>}
              <span className="flex items-center gap-1.5"><CalendarDays className="size-3.5" aria-hidden="true" />{t("addedOn", { date: format.dateTime(contact.createdAt, "date") })}</span>
            </p>
          </div>
        </div>
      </RecordHeader>
      {!writable && <Alert><AlertDescription>{t("viewOnlyRecord")}</AlertDescription></Alert>}
      <StaleNotice />
      <PossibleDuplicates items={contact.possibleDuplicates.map((item) => ({ id: item.id, name: item.name, href: `${back}/${item.id}`, hint: t("addedOn", { date: format.dateTime(item.createdAt, "date") }) }))} kind="person" />
      {/* Profile, context and history side by side on wide screens; history spans
          the row below on medium screens; one column on phones. */}
      <RecordGrid
        profile={<>
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><UserRound className="size-4 text-muted-foreground" aria-hidden="true" />{t("details")}</CardTitle></CardHeader>
            <CardContent><ContactFields email={value("email")} phone={value("phone")} social={value("social")} icons={{ email: <Mail aria-hidden="true" />, phone: <Phone aria-hidden="true" />, social: <AtSign aria-hidden="true" /> }} /></CardContent></Card>
          {(custom.definitions.length > 0 || can(workspace.role, "crm:fields_write")) && <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><SlidersHorizontal className="size-4 text-muted-foreground" aria-hidden="true" />{t("customFields")}</CardTitle></CardHeader>
            <CardContent><CustomFields fields={custom.definitions} values={custom.values} related={custom.related} tenantId={tenantId} manageHref={can(workspace.role, "crm:fields_write") ? `/workspaces/${tenantId}/crm/settings/fields?object=person` : null} /></CardContent></Card>}
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="size-4 text-muted-foreground" aria-hidden="true" />{t("companies")}</CardTitle></CardHeader>
            <CardContent><CompanyLinks tenantId={tenantId} contactId={contactId} links={contact.companies} writable={writable} /></CardContent></Card>
        </>}
        context={<>
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />{t("fields.notes")}</CardTitle></CardHeader>
            <CardContent><ContactNotes value={contact.notes} /></CardContent></Card>
          <Card className="gap-3"><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />{old("marketingPreferences")}</CardTitle></CardHeader>
            <CardContent className="space-y-3"><ItemGroup className="gap-3">{(["email", "sms", "social"] as const).map((channel) => { const latest = contact.effectiveConsents.find((row) => row.channel === channel && row.purpose === "marketing"); return <Item role="listitem" key={channel} size="sm" className="justify-between p-0"><ItemTitle className="text-xs">{labels(channel as ConsentLabel)}</ItemTitle><Badge variant="secondary" className={latest?.status === "granted" ? "bg-success-tint text-success" : latest?.status === "withdrawn" ? "bg-warning-tint text-warning" : "text-muted-foreground"}>{latest ? labels(latest.status as ConsentLabel) : old("notRecorded")}</Badge></Item>; })}</ItemGroup>
              <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">{old("aContactRecordDoesNotImplyPermissionTo")}</p></CardContent></Card>
        </>}
        history={<>
          <Tabs defaultValue="activity" className="gap-3">
            <TabsList><TabsTrigger value="activity">{t("activityTab")}</TabsTrigger><TabsTrigger value="consent">{old("consentHistory")}</TabsTrigger></TabsList>
            <TabsContent value="activity"><Card><CardContent><ActivityTimeline items={activity} tenantId={tenantId} subject="person" currentUserId={session.user.id} customLabels={Object.fromEntries(custom.definitions.map((field) => [field.key, field.label]))} /></CardContent></Card></TabsContent>
            <TabsContent value="consent"><Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-sm">{old("consentHistory")}</CardTitle>{writable && <ConsentForm tenantId={tenantId} contactId={contactId} />}</CardHeader>
              <CardContent>{contact.consents.length ? <ItemGroup className="gap-5">{contact.consents.map((consent) => <Item role="listitem" key={consent.id} className="min-w-0 items-start rounded-none border-l-2 border-l-border p-0 pl-4"><ItemContent className="min-w-0"><ItemHeader><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium capitalize">{consent.channel ? labels(consent.channel as ConsentLabel) : old("channelUnavailable")}</span><Badge variant="secondary" className={consent.status === "granted" ? "bg-success-tint text-success" : consent.status === "withdrawn" ? "bg-warning-tint text-warning" : ""}>{labels(consent.status as ConsentLabel)}</Badge>{consent.status === "granted" && contact.effectiveConsents.some((event) => event.channel === consent.channel && event.purpose === consent.purpose && event.status === "withdrawn") && <Badge variant="secondary" className="text-muted-foreground">{old("didNotOverrideWithdrawal")}</Badge>}<time className="ml-auto text-[11px] text-muted-foreground" dateTime={consent.occurredAt.toISOString()}>{format.dateTime(consent.occurredAt, "dateTime")}</time></div></ItemHeader><ItemTitle className="text-xs">{old("consentNotice", { purpose: labels(consent.purpose as ConsentLabel), version: labels(consent.noticeVersion as ConsentLabel) })}</ItemTitle><p className="mt-1 text-[11px] text-muted-foreground">{old("recordedBy", { date: format.dateTime(consent.recordedAt, "dateTime"), actor: consent.recordedBy ? consent.recordedBy === session.user.id ? old("you") : old("aWorkspaceMember") : old("legacyActorUnavailable") })}</p><p className="mt-2 break-words text-xs font-medium">{consent.source}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{consent.evidence}</p></ItemContent></Item>)}</ItemGroup>
                : <Empty className="p-3 py-5 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">{old("noConsentRecorded")}</EmptyTitle><EmptyDescription>{old("whenSomeoneSharesAChannelPreferenceRecordTheir")}</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></TabsContent>
          </Tabs>
        </>} />
      {can(workspace.role, "contacts:erase") && <div className="flex justify-end"><EraseContact tenantId={tenantId} contactId={contactId} /></div>}
    </div>
  </RecordProvider>;
}
