"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2, MoreHorizontal, Plus, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { RecordPicker } from "./record-picker";
import { useCrmRequest } from "./request";

type Link = { companyId: string; name: string; domain: string | null; title: string; isPrimary: boolean };

function TitleEditor({ label, value, onSave }: { label: string; value: string; onSave: (title: string) => Promise<string | null> }) {
  const t = useTranslations("Crm");
  const [draft, setDraft] = useState(value), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function commit() {
    if (draft.trim() === value) return;
    setBusy(true); const failure = await onSave(draft.trim()); setBusy(false);
    setError(failure ?? "");
  }
  return <div className="mt-1 space-y-1">
    <Input aria-label={label} value={draft} maxLength={100} disabled={busy} placeholder={t("addRole")} onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void commit(); } if (event.key === "Escape") setDraft(value); }} onBlur={() => void commit()}
      className="h-7 border-transparent bg-transparent px-1.5 text-xs shadow-none hover:bg-muted focus-visible:bg-background" />
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

/** A person's explicit organization relationships, with one primary company. */
export function CompanyLinks({ tenantId, contactId, links, writable }: { tenantId: string; contactId: string; links: Link[]; writable: boolean }) {
  const crmRequest = useCrmRequest();
  const t = useTranslations("Crm");
  const router = useRouter();
  const [error, setError] = useState("");
  const base = `/api/workspaces/${tenantId}/contacts/${contactId}/companies`;
  async function mutate(path: string, method: string, body?: unknown) {
    const result = await crmRequest(path, { method, body });
    if (!result.ok) return result.error;
    router.refresh(); return null;
  }
  async function link(companyId: string) { return mutate(base, "POST", { companyId }); }
  async function createAndLink(name: string) {
    const created = await crmRequest<{ id: string }>(`/api/workspaces/${tenantId}/companies`, { method: "POST", body: { name } });
    if (!created.ok) return created.error;
    return link(created.data.id);
  }
  async function act(action: Promise<string | null>) { setError((await action) ?? ""); }
  return <div className="space-y-3">
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {links.length ? <ItemGroup className="gap-1">{links.map((item) => <Item role="listitem" key={item.companyId} size="sm" className="items-start rounded-lg px-2 hover:bg-muted/60">
      <ItemMedia variant="icon" className="mt-0.5 size-8 rounded-md border bg-card"><Building2 aria-hidden="true" /></ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="flex flex-wrap items-center gap-1.5"><Link href={`/workspaces/${tenantId}/crm/companies/${item.companyId}`} className="truncate rounded-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{item.name}</Link>
          {item.isPrimary && <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[11px] font-normal">{t("primary")}</Badge>}</ItemTitle>
        {writable ? <TitleEditor label={t("roleAtCompany", { company: item.name })} value={item.title} onSave={(title) => mutate(`${base}/${item.companyId}`, "PATCH", { title })} />
          : <ItemDescription className="text-xs">{item.title || item.domain || t("noRoleRecorded")}</ItemDescription>}
      </ItemContent>
      {writable && <ItemActions><DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t("companyActions", { company: item.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!item.isPrimary && <DropdownMenuItem onSelect={() => void act(mutate(`${base}/${item.companyId}`, "PATCH", { isPrimary: true }))}><Star aria-hidden="true" />{t("makePrimary")}</DropdownMenuItem>}
          <DropdownMenuItem asChild><Link href={`/workspaces/${tenantId}/crm/companies/${item.companyId}`}><Building2 aria-hidden="true" />{t("openCompany")}</Link></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void act(mutate(`${base}/${item.companyId}`, "DELETE"))}>{t("unlinkCompany")}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu></ItemActions>}
    </Item>)}</ItemGroup> : <Empty className="p-3 md:p-3"><EmptyHeader><EmptyTitle className="text-sm">{t("noCompanyYet")}</EmptyTitle><EmptyDescription>{writable ? t("linkACompanyToSeeWhereThisPersonWorks") : t("noCompanyHasBeenLinked")}</EmptyDescription></EmptyHeader></Empty>}
    {writable && <RecordPicker endpoint={`/api/workspaces/${tenantId}/companies`} exclude={links.map((item) => item.companyId)}
      toItem={(row) => ({ id: String(row.id), label: String(row.name), hint: row.domain ? String(row.domain) : null })}
      trigger={<Button variant="outline" size="sm" className="w-full justify-start text-muted-foreground"><Plus aria-hidden="true" />{t("linkCompany")}</Button>}
      title={t("linkCompany")} placeholder={t("searchCompanies")} emptyLabel={t("noCompaniesFound")}
      onSelect={(item) => link(item.id)} createLabel={(query) => t("createCompanyNamed", { name: query })} onCreate={createAndLink} />}
  </div>;
}
