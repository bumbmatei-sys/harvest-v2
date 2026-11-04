import Link from "next/link";
import { ArrowRight, Search, ShieldCheck, UsersRound } from "lucide-react";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { listContacts } from "@/server/contacts";
import { AccessError, can } from "@/server/permissions";
import { contactQuery, uuidInput } from "@/lib/contact-input";
import { ContactForm } from "@/components/contact-form";
import { AccessState } from "@/components/access-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious, PaginationEllipsis } from "@/components/ui/pagination";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
export default async function ContactsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const parsed = contactQuery.safeParse(await searchParams);
  const query = parsed.success ? parsed.data : { q: "", page: 1 };
  const result = await Promise.all([getWorkspace(getDb(), session.user.id, tenantId), listContacts(getDb(), session.user.id, tenantId, query)]).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!result) return <AccessState />;
  const [workspace, { rows, total, page, q }] = result;
    const writable = can(workspace.role, "contacts:write"), base = `/workspaces/${tenantId}/contacts`;
    const pageLink = (next: number) => `${base}?${new URLSearchParams({ q, page: String(next) })}`;
    return <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><UsersRound className="size-3.5" aria-hidden="true" />YOUR PEOPLE</div><h1 className="text-[28px] font-semibold tracking-tight">Contacts</h1><p className="mt-2 text-sm text-muted-foreground">Get to know your people. Keep every connection in one place.</p></div>{writable && <div className="pt-6"><ContactForm tenantId={tenantId} /></div>}</div>
      {!parsed.success && <Alert variant="destructive"><AlertDescription>Check your search or page number. Showing the first page.</AlertDescription></Alert>}
      {!writable && <Alert><AlertDescription>You have view-only access. Ask a workspace admin to add or update contacts.</AlertDescription></Alert>}
      <div className="space-y-4"><form action={base} className="flex gap-2"><InputGroup className="h-10 flex-1 border-transparent bg-muted"><Label htmlFor="contact-search" className="sr-only">Search contacts</Label><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput id="contact-search" name="q" defaultValue={q} placeholder="Search by name, email, phone or handle…" maxLength={100} /></InputGroup><Button variant="outline" className="h-10">Search</Button></form>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-medium">All contacts<Badge variant="secondary" className="rounded-md">{total}</Badge></div><span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><ShieldCheck className="size-3.5" aria-hidden="true" />Private to this workspace</span></div></div>
      {rows.length ? <Card className="gap-0 overflow-hidden py-0"><Table><TableHeader><TableRow><TableHead className="pl-5">Name</TableHead><TableHead>Email</TableHead><TableHead className="hidden sm:table-cell">Phone</TableHead><TableHead className="hidden lg:table-cell">Added</TableHead><TableHead><span className="sr-only">Open contact</span></TableHead></TableRow></TableHeader><TableBody>{rows.map((contact) => <TableRow key={contact.id} className="h-11"><TableCell className="py-1.5 pl-5"><Link href={`${base}/${contact.id}`} className="flex items-center gap-3 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"><Avatar className="size-8" aria-hidden="true"><AvatarFallback className="text-xs text-muted-foreground">{contact.name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("")}</AvatarFallback></Avatar>{contact.name}</Link></TableCell><TableCell className="text-xs text-muted-foreground">{contact.identifiers.find((item) => item.kind === "email")?.value ?? "—"}</TableCell><TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{contact.identifiers.find((item) => item.kind === "phone")?.value ?? "—"}</TableCell><TableCell className="hidden text-xs text-muted-foreground lg:table-cell">{contact.createdAt.toISOString().slice(0, 10)}</TableCell><TableCell className="pr-4"><Button variant="ghost" size="icon-sm" asChild><Link href={`${base}/${contact.id}`} aria-label={`Open ${contact.name}`}><ArrowRight aria-hidden="true" /></Link></Button></TableCell></TableRow>)}</TableBody></Table></Card> : <Empty className="grid min-h-[290px] grid-cols-1 items-center gap-6 border border-solid bg-card p-7 text-left sm:grid-cols-2 sm:p-10">
        <div className="space-y-5"><EmptyHeader className="items-start text-left"><EmptyMedia variant="icon"><UsersRound aria-hidden="true" /></EmptyMedia><EmptyTitle><h2>{q ? "No matching contacts" : page > 1 ? "No contacts on this page" : "Every connection starts somewhere"}</h2></EmptyTitle><EmptyDescription>{q ? "Try another name or identifier, or clear your search to see everyone." : page > 1 ? "Return to the first page to see your contacts." : "Add your first contact and keep the details that make your next conversation more personal."}</EmptyDescription></EmptyHeader><EmptyContent className="items-start">{q || page > 1 ? <Button variant="outline" asChild><Link href={base}>Clear search</Link></Button> : writable && <ContactForm tenantId={tenantId} />}</EmptyContent></div>
        <div aria-hidden="true" className="hidden h-48 items-center justify-center rounded-xl bg-muted sm:flex"><Card className="w-4/5 gap-4 p-4"><div className="flex items-center gap-3"><Skeleton className="size-9 rounded-full" /><div className="space-y-2"><Skeleton className="h-2 w-20" /><Skeleton className="h-1.5 w-28" /></div></div>{[1, 2, 3].map((row) => <div key={row} className="flex gap-3"><Skeleton className="h-2 w-12" /><Skeleton className="h-2 flex-1" /></div>)}</Card></div>
      </Empty>}
      {(total > 20 || page > 1) && <Pagination aria-label="Contact pages"><PaginationContent>
        <PaginationItem><PaginationPrevious href={page > 1 ? pageLink(page - 1) : undefined} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined} className={page <= 1 ? "pointer-events-none opacity-50" : ""} /></PaginationItem>
        {Array.from(new Set([1, Math.max(1, page - 1), page, Math.min(Math.ceil(total / 20), page + 1), Math.max(1, Math.ceil(total / 20))])).filter((number) => number > 0).sort((a, b) => a - b).map((number, index, numbers) => <PaginationItem key={number} className="flex items-center">{index > 0 && number - numbers[index - 1] > 1 && <PaginationEllipsis />}<PaginationLink href={pageLink(number)} isActive={page === number} aria-label={`Page ${number}`}>{number}</PaginationLink></PaginationItem>)}
        <PaginationItem><PaginationNext href={page * 20 < total ? pageLink(page + 1) : undefined} aria-disabled={page * 20 >= total} tabIndex={page * 20 >= total ? -1 : undefined} className={page * 20 >= total ? "pointer-events-none opacity-50" : ""} /></PaginationItem>
      </PaginationContent></Pagination>}
      <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />Contact details and marketing consent are separate. Adding a person never subscribes them to a channel.</p>
    </div>;
}
