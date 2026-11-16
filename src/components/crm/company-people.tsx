"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MoreHorizontal, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
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
  const linkPerson = writable && <RecordPicker endpoint={`/api/workspaces/${tenantId}/contacts`} exclude={people.map((person) => person.id)} align="end"
    toItem={(row) => ({ id: String(row.id), label: String(row.name), hint: (row.identifiers as { kind: string; value: string }[] | undefined)?.find((item) => item.kind === "email")?.value ?? null })}
    trigger={<Button variant="outline" size="sm"><UserPlus aria-hidden="true" />{t("linkPerson")}</Button>}
    title={t("linkPerson")} placeholder={t("searchPeople")} emptyLabel={t("noPeopleFound")} onSelect={(item) => link(item.id)} />;
  const addPerson = writable && <ContactForm tenantId={tenantId} company={company} variant="outline" />;
  const columns: DataTableColumn[] = [
    { id: "name", header: t("name"), card: "title", className: "overflow-hidden py-1.5 pl-3" },
    { id: "role", header: t("role"), showFrom: "@md", className: "w-44 truncate text-xs text-muted-foreground" },
    { id: "email", header: t("email"), showFrom: "@3xl", className: "w-56 truncate text-xs text-muted-foreground" },
    ...(writable ? [{ id: "actions", header: t("actions"), srOnlyHeader: true, card: "actions", className: "w-14 pr-2" } satisfies DataTableColumn] : []),
  ];
  const rows: DataTableRow[] = people.map((person) => ({ id: person.id, label: person.name, className: "h-11", cells: {
    name: <><Link href={`/workspaces/${tenantId}/crm/people/${person.id}`} className="inline-flex min-w-0 max-w-full items-center gap-2.5 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar className="size-7 shrink-0" aria-hidden="true"><AvatarFallback className="text-[11px] text-muted-foreground">{initials(person.name)}</AvatarFallback></Avatar><span className="min-w-0 flex-1 truncate">{person.name}</span>
      {person.isPrimary && <StatusBadge label={t("primary")} className="hidden shrink-0 @lg:inline-flex" />}</Link>
      <span className="mt-0.5 block truncate pl-9.5 text-xs text-muted-foreground @md:hidden group-data-[layout=cards]/results:hidden">{person.title || t("noRoleRecorded")}</span></>,
    role: person.title || t("noRoleRecorded"),
    email: person.email ?? t("notProvided"),
    actions: <DropdownMenu modal={false}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("personActions", { name: person.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`/workspaces/${tenantId}/crm/people/${person.id}`}>{t("openPerson")}</Link></DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => void unlink(person.id)}>{t("removeFromCompany")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>,
  } }));
  return <div className="space-y-3">
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {people.length ? <>
      <DataTable label={t("people")} columns={columns} rows={rows} fixed />
      {writable && <div className="flex flex-wrap gap-2">{linkPerson}{addPerson}</div>}
    </> : <EmptyState size="compact" title={t("noPeopleAtThisCompany")} description={writable ? t("linkSomeoneYouAlreadyKnowOrAddANewPerson") : t("nobodyHasBeenLinkedYet")} action={linkPerson || undefined} secondary={addPerson || undefined} />}
  </div>;
}
