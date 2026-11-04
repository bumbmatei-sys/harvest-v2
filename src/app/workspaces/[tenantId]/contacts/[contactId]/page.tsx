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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import { EraseContact } from "@/components/erase-contact";
import { ConsentForm } from "@/components/consent-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
export default async function ContactDetailPage({ params }: { params: Promise<{ tenantId: string; contactId: string }> }) {
  const session = await pageSession(), { tenantId, contactId } = await params;
  const back = `/workspaces/${tenantId}/contacts`;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(contactId).success) return <AccessState missing href={back} />;
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), getContact(getDb(), session.user.id, tenantId, contactId)]).catch((error: unknown) => { if (error instanceof AccessError) return { status: error.status }; throw error; });
  if (!Array.isArray(result)) return <AccessState missing={result.status === 404} href={result.status === 404 ? back : "/workspaces"} />;
  const [workspace, contact] = result, writable = can(workspace.role, "contacts:write");
  return <div className="space-y-7">
    <Button asChild variant="ghost" size="sm" className="-ml-2 text-muted-foreground"><Link href={back}><ArrowLeft aria-hidden="true" />All contacts</Link></Button>
    <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-4"><Avatar className="size-14 border" aria-hidden="true"><AvatarFallback className="bg-selected text-lg font-medium">{contact.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}</AvatarFallback></Avatar><div className="min-w-0"><h1 className="break-words text-[28px] font-semibold tracking-tight">{contact.name}</h1><p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" aria-hidden="true" />Added {contact.createdAt.toISOString().slice(0, 10)}</p></div></div>{writable && <ContactForm tenantId={tenantId} contact={contact} variant="outline" />}</div>
    {!writable && <Alert><AlertDescription>You have view-only access to this contact.</AlertDescription></Alert>}
    <Tabs defaultValue="overview" className="space-y-5"><TabsList aria-label="Contact sections"><TabsTrigger value="overview">Contact overview</TabsTrigger></TabsList><TabsContent value="overview">
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
      <div className="space-y-4"><Card><CardHeader><CardTitle className="text-sm">Contact details</CardTitle></CardHeader><CardContent><dl className="space-y-5">{([{ kind: "email", label: "Email", icon: Mail }, { kind: "phone", label: "Phone", icon: Phone }, { kind: "social", label: "Social handle", icon: AtSign }] as const).map(({ kind, label, icon: Icon }) => <div key={kind}><dt className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden="true" />{label}</dt><dd className="break-all text-sm">{contact.identifiers.find((item) => item.kind === kind)?.value ?? <span className="text-xs text-muted-foreground">Not provided</span>}</dd></div>)}</dl></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />Marketing preferences</CardTitle></CardHeader><CardContent className="space-y-3">{(["email", "sms", "social"] as const).map((channel) => { const latest = contact.consents.find((row) => row.channel === channel && row.purpose === "marketing"); return <div key={channel} className="flex items-center justify-between gap-3 text-xs"><span className="capitalize">{channel === "sms" ? "SMS" : channel}</span><Badge variant="secondary" className={latest?.status === "granted" ? "bg-success-tint text-success" : latest?.status === "withdrawn" ? "bg-warning-tint text-warning" : "text-muted-foreground"}>{latest?.status ?? "Not recorded"}</Badge></div>; })}<p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">A contact record does not imply permission to send marketing.</p></CardContent></Card></div>
      <div className="space-y-4"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><StickyNote className="size-4 text-muted-foreground" aria-hidden="true" />Notes</CardTitle></CardHeader><CardContent>{contact.notes ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{contact.notes}</p> : <Empty className="p-3 md:p-3"><EmptyHeader><EmptyTitle className="text-sm">No notes yet</EmptyTitle><EmptyDescription>A little context can make the next conversation more meaningful.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle className="text-sm">Consent history</CardTitle>{writable && <ConsentForm tenantId={tenantId} contactId={contactId} />}</CardHeader><CardContent>{contact.consents.length ? <ol className="space-y-5">{contact.consents.map((consent) => <li key={consent.id} className="border-l-2 pl-4"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium capitalize">{consent.channel === "sms" ? "SMS" : consent.channel}</span><Badge variant="secondary" className={consent.status === "granted" ? "bg-success-tint text-success" : consent.status === "withdrawn" ? "bg-warning-tint text-warning" : ""}>{consent.status}</Badge><time className="ml-auto text-[11px] text-muted-foreground" dateTime={consent.occurredAt.toISOString()}>{consent.occurredAt.toISOString().slice(0, 16).replace("T", " ")} UTC</time></div><p className="mt-2 text-xs font-medium">{consent.purpose.replaceAll("_", " ")} · {consent.noticeVersion}</p><p className="mt-1 text-[11px] text-muted-foreground">Recorded {consent.recordedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · by {consent.recordedBy ? consent.recordedBy === session.user.id ? "you" : "a workspace member" : "Legacy actor unavailable"}</p><p className="mt-2 break-words text-xs font-medium">{consent.source}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{consent.evidence}</p></li>)}</ol> : <Empty className="p-3 py-5 md:p-3"><EmptyHeader><EmptyMedia variant="icon"><ShieldCheck aria-hidden="true" /></EmptyMedia><EmptyTitle className="text-sm">No consent recorded</EmptyTitle><EmptyDescription>When someone shares a channel preference, record their choice and the supporting evidence here.</EmptyDescription></EmptyHeader></Empty>}</CardContent></Card></div>
    </div></TabsContent></Tabs>
    {can(workspace.role, "contacts:erase") && <div className="flex justify-end"><EraseContact tenantId={tenantId} contactId={contactId} /></div>}
  </div>;
}
