import { getTranslations, getFormatter } from "next-intl/server";
import Link from "next/link";
import { ArrowLeft, AtSign, CalendarDays, Mail, Phone, ShieldCheck, StickyNote } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getContact } from "@/server/contacts";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { ContactForm } from "@/components/contact-form";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemHeader, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { ConsentLabel } from "@/lib/consent-labels";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { EraseContact } from "@/components/erase-contact";
import { ConsentForm } from "@/components/consent-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export default async function ContactDetailPage({ params }: { params: Promise<{ tenantId: string; contactId: string }> }) {
  const t = await getTranslations("AppWorkspacesContactsPage");
  const format = await getFormatter();
  const labels = await getTranslations("ConsentLabels");
  const session = await pageSession(), { tenantId, contactId } = await params;
  const back = `/workspaces/${tenantId}/contacts`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(contactId).success) return <AccessState missing href={back} />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getContact(getDb(), session.user.id, tenantId, contactId)]).catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, contact] = result, writable = can(workspace.role, "contacts:write");
  return <div className="space-y-7">
    <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground"><Link href={back}><ArrowLeft aria-hidden="true" />{t("allContacts")}</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-4"><Avatar className="size-14 border" aria-hidden="true"><AvatarFallback className="bg-selected text-lg font-medium">{contact.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}</AvatarFallback></Avatar><div className="min-w-0"><h1 className="break-words text-[28px] font-semibold tracking-tight">{contact.name}</h1><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />{t("addedOn", { date: format.dateTime(contact.createdAt, "date") })}</p></div></div>{writable && <ContactForm tenantId={tenantId} contact={contact} variant="outline" />}</div>
    {!writable && <Alert><AlertDescription>{t("youHaveViewOnlyAccessToThisContact")}</AlertDescription></Alert>}
    <div className="space-y-5"><h2 className="text-sm font-medium">{t("contactOverview")}</h2><Separator />
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
      <div className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">{t("contactDetails")}</CardTitle></CardHeader><CardContent><ItemGroup className="gap-4">{([{ kind: "email", label: t("email"), icon: Mail }, { kind: "phone", label: t("phone"), icon: Phone }, { kind: "social", label: t("socialHandle"), icon: AtSign }] as const).map(({ kind, label, icon: Icon }) => <Item role="listitem" key={kind} size="sm" className="items-start p-0"><ItemMedia><Icon className="size-3.5 text-muted-foreground" aria-hidden="true" /></ItemMedia><ItemContent className="min-w-0"><ItemTitle className="text-xs text-muted-foreground">{label}</ItemTitle><ItemDescription className="break-all text-sm text-foreground">{contact.identifiers.find((item) => item.kind === kind)?.value ?? t("notProvided")}</ItemDescription></ItemContent></Item>)}</ItemGroup></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />{t("marketingPreferences")}</CardTitle></CardHeader><CardContent className="space-y-3"><ItemGroup className="gap-3">{(["email", "sms", "social"] as const).map((channel) => { const latest = contact.effectiveConsents.find((row) => row.channel === channel && row.purpose === "marketing"); return <Item role="listitem" key={channel} size="sm" className="justify-between p-0"><ItemTitle className="text-xs">{labels(channel as ConsentLabel)}</ItemTitle><Badge variant="secondary" className={latest?.status === "granted" ? "bg-success-tint text-success" : latest?.status === "withdrawn" ? "bg-warning-tint text-warning" : "text-muted-foreground"}>{latest ? labels(latest.status as ConsentLabel) : t("notRecorded")}</Badge></Item>; })}</ItemGroup><p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">{t("aContactRecordDoesNotImplyPermissionTo")}</p></CardContent></Card></div>
      <div className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />{t("notes")}</CardTitle></CardHeader><CardContent>{contact.notes ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{contact.notes}</p> : <Empty className="p-3 md:p-3"><EmptyHeader><EmptyTitle className="text-sm">{t("noNotesYet")}</EmptyTitle><EmptyDescription>{t("aLittleContextCanMakeTheNextConversation")}</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-sm">{t("consentHistory")}</CardTitle>{writable && <ConsentForm tenantId={tenantId} contactId={contactId} />}</CardHeader><CardContent>{contact.consents.length ? <ItemGroup className="gap-5">{contact.consents.map((consent) => <Item role="listitem" key={consent.id} className="min-w-0 items-start rounded-none border-l-2 border-l-border p-0 pl-4"><ItemContent className="min-w-0"><ItemHeader><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium capitalize">{consent.channel ? labels(consent.channel as ConsentLabel) : t("channelUnavailable")}</span><Badge variant="secondary" className={consent.status === "granted" ? "bg-success-tint text-success" : consent.status === "withdrawn" ? "bg-warning-tint text-warning" : ""}>{labels(consent.status as ConsentLabel)}</Badge>{consent.status === "granted" && contact.effectiveConsents.some((event) => event.channel === consent.channel && event.purpose === consent.purpose && event.status === "withdrawn") && <Badge variant="secondary" className="text-muted-foreground">{t("didNotOverrideWithdrawal")}</Badge>}<time className="ml-auto text-[11px] text-muted-foreground" dateTime={consent.occurredAt.toISOString()}>{format.dateTime(consent.occurredAt, "dateTime")}</time></div></ItemHeader><ItemTitle className="text-xs">{t("consentNotice", { purpose: labels(consent.purpose as ConsentLabel), version: labels(consent.noticeVersion as ConsentLabel) })}</ItemTitle><p className="mt-1 text-[11px] text-muted-foreground">{t("recordedBy", { date: format.dateTime(consent.recordedAt, "dateTime"), actor: consent.recordedBy ? consent.recordedBy === session.user.id ? t("you") : t("aWorkspaceMember") : t("legacyActorUnavailable") })}</p><p className="mt-2 break-words text-xs font-medium">{consent.source}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{consent.evidence}</p></ItemContent></Item>)}</ItemGroup> : <Empty className="p-3 py-5 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">{t("noConsentRecorded")}</EmptyTitle><EmptyDescription>{t("whenSomeoneSharesAChannelPreferenceRecordTheir")}</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></div>
    </div></div>
    {can(workspace.role, "contacts:erase") && <div className="flex justify-end"><EraseContact tenantId={tenantId} contactId={contactId} /></div>}
  </div>;
}
