"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChartLine, Copy, MailPlus, MoreHorizontal, Plus, Search } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/lib/status-tone";
import { TemplatePicker } from "@/components/newsletter/template-picker";
import { useCrmRequest } from "@/components/crm/request";
import type { BrandKit } from "@/lib/email/blocks";
import { blankDocument, templateDocument, type TemplateId } from "@/lib/email/templates";

export type CampaignRow = { id: string; name: string; state: string; scheduledAt: string | null };
const tones: Record<string, StatusTone> = { draft: "neutral", reviewed: "info", scheduled: "pending", sending: "pending", sent: "success", cancelled: "neutral", failed: "danger" };
type Sort = "name" | "status";

/** The Campaigns list: a template row to start from, then a searchable, sortable table. */
export function CampaignsList({ tenantId, ministryName, campaigns, brand }: { tenantId: string; ministryName: string; campaigns: CampaignRow[]; brand: BrandKit }) {
  const t = useTranslations("NewsletterCampaigns"), router = useRouter(), request = useCrmRequest();
  const [query, setQuery] = useState(""), [sort, setSort] = useState<Sort>("name"), [error, setError] = useState(""), [picker, setPicker] = useState(false), [busy, setBusy] = useState(false);
  const base = `/workspaces/${tenantId}/newsletter/campaigns`;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return campaigns.filter((c) => !needle || c.name.toLowerCase().includes(needle)).sort((a, b) => sort === "status" ? a.state.localeCompare(b.state) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  }, [campaigns, query, sort]);

  async function create(id: TemplateId | "blank") {
    setBusy(true); setError("");
    const doc = id === "blank" ? blankDocument(brand) : templateDocument(id, brand);
    const name = id === "blank" ? t("editor.draft") : t(`templates.${id}.name`);
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/campaigns`, { method: "POST", body: { name, subject: name, preheader: null, selection: { listIds: [], segmentIds: [] }, content: doc } });
    setBusy(false);
    if (!result.ok) { setError(t("createFailed")); return; }
    router.push(`${base}/${result.data.id}`);
  }
  async function duplicate(c: CampaignRow) {
    setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/newsletter/campaigns/${c.id}/duplicate`, { method: "POST", body: { name: `${c.name} (2)`.slice(0, 100) } });
    if (!result.ok) { setError(result.error); return; }
    router.push(`${base}/${result.data.id}`);
  }

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title" }, { id: "status", header: t("columns.status") },
    { id: "when", header: t("columns.when"), showFrom: "@md" }, { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-16" },
  ];
  const tableRows: DataTableRow[] = rows.map((c) => ({ id: c.id, label: c.name, cells: {
    name: <Link href={`${base}/${c.id}`} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline">{c.name}</Link>,
    status: <StatusBadge tone={tones[c.state] ?? "neutral"} label={t(`status.${c.state}` as "status.draft")} />,
    when: c.scheduledAt ? new Date(c.scheduledAt).toLocaleString() : t("notScheduled"),
    actions: <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("menu", { name: c.name })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => router.push(`${base}/${c.id}`)}>{t("open")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => router.push(`/workspaces/${tenantId}/newsletter/analytics/${c.id}`)}><ChartLine aria-hidden="true" />{t("analytics")}</DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={() => void duplicate(c)}><Copy aria-hidden="true" />{t("duplicate")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>,
  } }));

  return <div className="min-w-0 space-y-8" data-campaigns-list>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("heading")}</h1>
      <Button type="button" className="min-h-11" onClick={() => setPicker(true)}><Plus aria-hidden="true" />{t("newCampaign")}</Button>
    </header>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    <section aria-labelledby="nl-templates" className="space-y-3"><h2 id="nl-templates" className="text-sm font-medium text-muted-foreground">{t("startFromTemplate")}</h2>
      <TemplatePicker brand={brand} ministryName={ministryName} busy={busy} onPick={(id) => void create(id)} /></section>
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="min-h-11 ps-9" type="search" aria-label={t("search")} placeholder={t("search")} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <NativeSelect aria-label={t("sort")} className="min-h-11 w-44" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <NativeSelectOption value="name">{t("sortName")}</NativeSelectOption><NativeSelectOption value="status">{t("sortStatus")}</NativeSelectOption></NativeSelect>
      </div>
      {campaigns.length === 0 ? <EmptyState icon={MailPlus} title={t("emptyTitle")} description={t("emptyBody")} />
        : rows.length === 0 ? <EmptyState icon={Search} size="compact" title={t("noMatch")} />
        : <DataTable label={t("heading")} columns={columns} rows={tableRows} />}
    </section>
    <Dialog open={picker} onOpenChange={setPicker}><DialogContent className="max-h-[90dvh] w-full overflow-y-auto sm:max-w-5xl"><DialogHeader><DialogTitle>{t("pickTemplate")}</DialogTitle></DialogHeader>
      <TemplatePicker brand={brand} ministryName={ministryName} busy={busy} onPick={(id) => void create(id)} /></DialogContent></Dialog>
  </div>;
}
