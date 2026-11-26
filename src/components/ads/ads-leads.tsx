"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, Plus, RotateCw, Trash2, UserPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useAdsError } from "@/components/ads/ads-error";
import { useAdAccounts } from "@/components/ads/use-ad-accounts";
import type { LeadFormView } from "@/lib/ads/api";
import { convertible, filterLeads, leadContact, leadName, leadStatusList, type DraftFormRow, type LeadView } from "@/lib/ads/leads-view";
import type { LeadStatus } from "@/lib/ads/ads";
import { notify } from "@/lib/toast";

type Tab = "forms" | "leads";

/**
 * Social media > Ads > Lead forms and leads. Forms built in Harvest (and the forms already on the ad account) on one tab; the leads they brought in on the other. A lead is held as an
 * ad-lead record, never as a CRM contact, until an owner or admin adds it; adding follows the hosted-form rules (matched on email or phone, no consent from the conversion itself).
 */
export function AdsLeads({ tenantId, initialTab }: { tenantId: string; initialTab: Tab }) {
  const t = useTranslations("Ads.leads"), l = useTranslations("Ads"), explain = useAdsError(), format = useFormatter(), router = useRouter();
  const { api, accounts, account, select, status } = useAdAccounts(tenantId);
  const [tab, setTab] = useState<Tab>(initialTab), [forms, setForms] = useState<LeadFormView[]>([]), [drafts, setDrafts] = useState<DraftFormRow[]>([]), [leads, setLeads] = useState<LeadView[]>([]);
  const [filter, setFilter] = useState<LeadStatus | "all">("all"), [loaded, setLoaded] = useState(false), [error, setError] = useState(""), [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]), [removing, setRemoving] = useState<LeadView | null>(null), [creating, setCreating] = useState(false);
  const accountId = account?.id ?? null;

  const [version, setVersion] = useState(0), reload = () => setVersion((value) => value + 1);
  useEffect(() => {
    if (!accountId) return;
    let live = true;
    Promise.all([api.leadForms(accountId), api.formDrafts(), api.leads(accountId)])
      .then(([f, d, le]) => { if (!live) return; setForms(f.forms); setDrafts(d.forms); setLeads(le.leads); setLoaded(true); })
      .catch((cause: unknown) => { if (live) setError(explain(cause)); });
    return () => { live = false; };
  }, [accountId, api, explain, version]);
  const run = async (key: string, work: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError("");
    try { await work(); reload(); if (done) notify.success(done); } catch (cause) { setError(explain(cause)); } finally { setBusy(null); }
  };

  const shownLeads = useMemo(() => filterLeads(leads, filter), [leads, filter]);
  const when = (iso: string | null) => iso ? format.dateTime(new Date(iso), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : l("table.dash");
  const base = `/workspaces/${tenantId}/social/ads`;

  const formColumns: DataTableColumn[] = [
    { id: "name", header: t("forms.name"), card: "title", className: "min-w-48" }, { id: "source", header: t("forms.source") }, { id: "network", header: t("forms.network") },
    { id: "state", header: t("forms.state") }, { id: "actions", header: t("forms.actions"), srOnlyHeader: true, card: "actions" },
  ];
  const formRows: DataTableRow[] = [
    ...drafts.map((draft): DataTableRow => ({ id: `draft-${draft.id}`, label: draft.title, cells: { name: draft.title, source: t("forms.harvest"), network: l(`networks.${draft.network}`),
      state: <StatusBadge tone={draft.publishedVersions ? "success" : "pending"} dot label={draft.publishedVersions ? t("forms.published", { count: draft.publishedVersions }) : t("forms.draft")} />,
      actions: <Button asChild variant="outline" size="responsive"><Link href={`${base}/leads/forms/${draft.id}`}>{t("forms.edit")}</Link></Button> } })),
    ...forms.map((form): DataTableRow => ({ id: `form-${form.id}`, label: form.name, cells: { name: form.name, source: t("forms.account"), network: account ? l(`networks.${account.network}`) : "",
      state: <StatusBadge tone={form.status === "active" ? "success" : "neutral"} dot label={t(form.status === "active" ? "forms.active" : "forms.archived")} />, actions: <span className="sr-only">{t("forms.none")}</span> } })),
  ];

  const leadColumns: DataTableColumn[] = [
    { id: "name", header: t("leads.name"), card: "title", className: "min-w-44" }, { id: "contact", header: t("leads.contact") },
    { id: "status", header: t("leads.status") }, { id: "submitted", header: t("leads.submitted"), showFrom: "@md" }, { id: "crm", header: t("leads.crm") }, { id: "actions", header: t("leads.actions"), srOnlyHeader: true, card: "actions" },
  ];
  const leadRows: DataTableRow[] = shownLeads.map((lead): DataTableRow => {
    const who = leadName(lead.fields) || t("leads.unnamed");
    return { id: lead.id, label: who, cells: { name: who, contact: leadContact(lead.fields) || l("table.dash"), submitted: when(lead.submittedAt),
      status: <NativeSelect value={lead.status} aria-label={t("leads.statusOf", { name: who })} className="min-h-11 w-40 lg:min-h-9" disabled={busy === lead.id} onChange={(event) => void run(lead.id, () => api.leadStatus(lead.id, event.target.value, lead.version))}>
        {leadStatusList.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}</NativeSelect>,
      crm: lead.inCrm ? <StatusBadge tone="success" dot label={t("leads.inCrm")} /> : convertible(lead)
        ? <Button type="button" variant="outline" size="responsive" disabled={busy === lead.id} onClick={() => void run(lead.id, async () => { await api.convertLead(lead.id); }, t("leads.added"))}><UserPlus aria-hidden="true" />{t("leads.addToCrm")}</Button>
        : <span className="text-muted-foreground">{t("leads.noContact")}</span>,
      actions: <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("leads.delete", { name: who })} onClick={() => setRemoving(lead)}><Trash2 aria-hidden="true" /></Button> } };
  });
  const unconverted = leads.filter(convertible).length;

  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><Button asChild variant="ghost" size="sm" className="-ms-2 mb-1"><Link href={base}><ArrowLeft aria-hidden="true" />{l("title")}</Link></Button>
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      {accounts.length > 1 && <NativeSelect value={account?.id ?? ""} onChange={(event) => { select(event.target.value); setLoaded(false); }} className="min-h-11 w-auto min-w-44 max-sm:w-full lg:min-h-9" aria-label={l("account.label")}>
        {accounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</NativeSelect>}
      {tab === "forms" ? <Button type="button" size="responsive" onClick={() => setCreating(true)} data-ads-new-form><Plus aria-hidden="true" />{t("forms.new")}</Button> : <>
        <Button type="button" variant="outline" size="responsive" disabled={!accountId || busy === "sync"} onClick={() => void run("sync", () => api.syncLeads(accountId!), t("leads.refreshed"))}><RotateCw aria-hidden="true" />{t("leads.refresh")}</Button>
        <Button type="button" size="responsive" disabled={!accountId || unconverted === 0 || busy === "all"} onClick={() => void run("all", () => api.convertNewLeads(accountId!), t("leads.addedAll"))} data-ads-convert-all><UserPlus aria-hidden="true" />{t("leads.addAll", { count: unconverted })}</Button></>}
    </div>
  </header>;

  let body: React.ReactNode;
  if (status === "loading") body = <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>;
  else if (status === "unavailable") body = <EmptyState icon={ClipboardList} title={l("states.unavailableTitle")} description={l("states.unavailable")} solid />;
  else if (status === "error") body = <Alert variant="destructive" role="alert"><AlertDescription>{l("states.error")}</AlertDescription></Alert>;
  else if (!account) body = <EmptyState icon={ClipboardList} title={l("empty.noAccountsTitle")} description={l("empty.noAccounts")} solid action={<Button asChild size="responsive"><Link href={base}>{t("toAds")}</Link></Button>} />;
  else body = <div className="flex flex-col gap-4" data-ads-leads-ready={loaded ? "true" : undefined}>
    <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="gap-4"><div className="overflow-x-auto [scrollbar-width:none]"><TabsList variant="line" aria-label={t("tabs")} className="h-auto gap-1">
      <TabsTrigger value="forms" className="min-h-11 flex-none lg:min-h-9">{t("tabForms")}</TabsTrigger><TabsTrigger value="leads" className="min-h-11 flex-none lg:min-h-9">{t("tabLeads", { count: leads.length })}</TabsTrigger></TabsList></div>
      <TabsContent value="forms"><DataTable label={t("forms.label")} columns={formColumns} rows={formRows} state={loaded ? "ready" : "loading"} empty={<EmptyState icon={ClipboardList} size="compact" title={t("forms.emptyTitle")} description={t("forms.empty")} />} /></TabsContent>
      <TabsContent value="leads"><DataTable label={t("leads.label")} columns={leadColumns} rows={leadRows} state={loaded ? "ready" : "loading"} selection={{ selected: picked, onChange: setPicked }}
        toolbar={{ filters: <NativeSelect value={filter} onChange={(event) => setFilter(event.target.value as LeadStatus | "all")} aria-label={t("leads.filter")} className="min-h-11 w-auto min-w-40 lg:min-h-9">
          <option value="all">{t("leads.all")}</option>{leadStatusList.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}</NativeSelect> }}
        bulk={{ label: t("leads.bulk"), actions: <Button type="button" variant="outline" size="responsive" onClick={() => void run("picked", async () => { for (const id of picked) { const lead = leads.find((item) => item.id === id); if (lead && convertible(lead)) await api.convertLead(id); } setPicked([]); }, t("leads.addedAll"))}><UserPlus aria-hidden="true" />{t("leads.addSelected")}</Button> }}
        empty={<EmptyState icon={ClipboardList} size="compact" title={t("leads.emptyTitle")} description={t("leads.empty")} />} /></TabsContent>
    </Tabs>
  </div>;

  return <div className="flex min-w-0 flex-col gap-6" data-testid="ads-leads-page">
    {header}
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {body}
    <NewFormDialog open={creating} onOpenChange={setCreating} accounts={accounts} initial={account?.id ?? ""} onCreate={async (network, url) => { const { id } = await api.createFormDraft(network, url); router.push(`${base}/leads/forms/${id}`); }} />
    <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }} title={t("leads.deleteTitle", { name: removing ? leadName(removing.fields) || t("leads.unnamed") : "" })} description={t("leads.deleteBody")} confirmLabel={t("leads.deleteConfirm")} cancelLabel={t("leads.cancel")}
      onConfirm={async () => { const lead = removing; setRemoving(null); if (lead) await run(lead.id, () => api.deleteLead(lead.id), t("leads.deleted")); }} />
  </div>;
}

function NewFormDialog({ open, onOpenChange, accounts, initial, onCreate }: { open: boolean; onOpenChange: (open: boolean) => void; accounts: { id: string; name: string; network: string }[]; initial: string; onCreate: (network: string, privacyUrl: string) => Promise<void> }) {
  const nf = useTranslations("Ads.leads.new"), l = useTranslations("Ads"), explain = useAdsError();
  const [accountId, setAccountId] = useState(initial), [url, setUrl] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const chosen = accounts.find((item) => item.id === accountId) ?? accounts[0], valid = /^https:\/\/[^\s]+$/.test(url.trim());
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <form onSubmit={async (event) => { event.preventDefault(); if (!chosen || !valid) return; setBusy(true); setError(""); try { await onCreate(chosen.network, url.trim()); } catch (cause) { setError(explain(cause)); setBusy(false); } }} className="flex flex-col gap-4">
      <DialogHeader><DialogTitle>{nf("title")}</DialogTitle><DialogDescription className="sr-only">{nf("description")}</DialogDescription></DialogHeader>
      {accounts.length > 1 && <Field><FieldLabel htmlFor="ads-new-form-account">{nf("account")}</FieldLabel><NativeSelect id="ads-new-form-account" className="min-h-11 w-full" value={chosen?.id ?? ""} onChange={(event) => setAccountId(event.target.value)}>
        {accounts.map((item) => <option key={item.id} value={item.id}>{l("account.option", { name: item.name, network: l.has(`networks.${item.network}`) ? l(`networks.${item.network}`) : l("networks.other") })}</option>)}</NativeSelect></Field>}
      <Field data-invalid={url !== "" && !valid || undefined}><FieldLabel htmlFor="ads-new-form-privacy">{nf("privacy")}</FieldLabel>
        <Input id="ads-new-form-privacy" type="url" inputMode="url" className="min-h-11" value={url} placeholder={nf("privacyPlaceholder")} aria-invalid={url !== "" && !valid || undefined} onChange={(event) => setUrl(event.target.value)} />
        {url !== "" && !valid && <FieldError>{nf("privacyInvalid")}</FieldError>}</Field>
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button type="button" variant="outline" size="responsive" onClick={() => onOpenChange(false)}>{nf("cancel")}</Button><Button type="submit" size="responsive" disabled={busy || !valid}>{nf("create")}</Button></DialogFooter>
    </form></DialogContent></Dialog>;
}
