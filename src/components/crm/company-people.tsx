"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ContactForm } from "@/components/contact-form";
import { initials } from "./format";
import { RecordPicker } from "./record-picker";
import { useCrmRequest } from "./request";

type Person = { id: string; name: string; title: string; isPrimary: boolean; email: string | null };

export function CompanyPeople({ tenantId, company, people, writable }: { tenantId: string; company: { id: string; name: string }; people: Person[]; writable: boolean }) {
  const crmRequest = useCrmRequest();
  const t = useTranslations("Crm");
  const router = useRouter();
  const [error, setError] = useState("");
  async function link(contactId: string) {
    const result = await crmRequest(`/api/workspaces/${tenantId}/contacts/${contactId}/companies`, { method: "POST", body: { companyId: company.id } });
    if (!result.ok) return result.error;
    router.refresh(); return null;
  }
  async function unlink(contactId: string) {
    const result = await crmRequest(`/api/workspaces/${tenantId}/contacts/${contactId}/companies/${company.id}`, { method: "DELETE" });
    setError(result.ok ? "" : result.error);
    if (result.ok) router.refresh();
  }
  const actions = writable && <div className="flex flex-wrap gap-2">
    <RecordPicker endpoint={`/api/workspaces/${tenantId}/contacts`} exclude={people.map((person) => person.id)} align="end"
      toItem={(row) => ({ id: String(row.id), label: String(row.name), hint: (row.identifiers as { kind: string; value: string }[] | undefined)?.find((item) => item.kind === "email")?.value ?? null })}
      trigger={<Button variant="outline" size="sm"><UserPlus aria-hidden="true" />{t("linkPerson")}</Button>}
      title={t("linkPerson")} placeholder={t("searchPeople")} emptyLabel={t("noPeopleFound")} onSelect={(item) => link(item.id)} />
    <ContactForm tenantId={tenantId} company={company} variant="outline" />
  </div>;
  return <div className="space-y-3">
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {people.length ? <>
      <div className="overflow-hidden rounded-lg border"><Table>
        <TableHeader><TableRow><TableHead className="pl-3">{t("name")}</TableHead><TableHead className="hidden sm:table-cell">{t("role")}</TableHead><TableHead className="hidden xl:table-cell">{t("email")}</TableHead>{writable && <TableHead className="w-10"><span className="sr-only">{t("actions")}</span></TableHead>}</TableRow></TableHeader>
        <TableBody>{people.map((person) => <TableRow key={person.id} className="h-11">
          <TableCell className="py-1.5 pl-3"><Link href={`/workspaces/${tenantId}/crm/people/${person.id}`} className="flex min-w-0 items-center gap-2.5 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="size-7" aria-hidden="true"><AvatarFallback className="text-[11px] text-muted-foreground">{initials(person.name)}</AvatarFallback></Avatar><span className="truncate">{person.name}</span>
            {person.isPrimary && <Badge variant="secondary" className="hidden h-5 rounded-md px-1.5 text-[11px] font-normal lg:inline-flex">{t("primary")}</Badge>}</Link>
            <span className="mt-0.5 block pl-9.5 text-xs text-muted-foreground sm:hidden">{person.title || t("noRoleRecorded")}</span></TableCell>
          <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{person.title || t("noRoleRecorded")}</TableCell>
          <TableCell className="hidden max-w-48 truncate text-xs text-muted-foreground xl:table-cell">{person.email ?? t("notProvided")}</TableCell>
          {writable && <TableCell className="pr-2"><DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("personActions", { name: person.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/workspaces/${tenantId}/crm/people/${person.id}`}>{t("openPerson")}</Link></DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => void unlink(person.id)}>{t("removeFromCompany")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>}
        </TableRow>)}</TableBody>
      </Table></div>
      {actions}
    </> : <Empty className="border border-dashed p-6 md:p-6"><EmptyHeader><EmptyTitle className="text-sm">{t("noPeopleAtThisCompany")}</EmptyTitle><EmptyDescription>{writable ? t("linkSomeoneYouAlreadyKnowOrAddANewPerson") : t("nobodyHasBeenLinkedYet")}</EmptyDescription></EmptyHeader>{actions && <EmptyContent>{actions}</EmptyContent>}</Empty>}
  </div>;
}
