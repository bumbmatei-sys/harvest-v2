"use client";
import { useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowUpDown, ClipboardList, Copy, MoreHorizontal, Plus, Search, Star } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { useContextualSidebar } from "@/components/editor/editor-context";
import { useCrmRequest } from "@/components/crm/request";
import { templateIcon } from "@/components/crm/forms/template-icons";
import { templateIds } from "@/lib/crm-forms";
import { emptyPrefs, parsePrefs, readPrefs, recents, toggleFavorite, touchViewed, writePrefs } from "@/lib/form-prefs";
import type { FormSummary } from "@/server/crm-forms";

type SortKey = "opened" | "edited" | "name" | "created";
const sortKeys: readonly SortKey[] = ["opened", "edited", "name", "created"];

function usePrefs(tenantId: string) {
  const subscribe = (notify: () => void) => { window.addEventListener("harvest-form-prefs", notify); window.addEventListener("storage", notify); return () => { window.removeEventListener("harvest-form-prefs", notify); window.removeEventListener("storage", notify); }; };
  const raw = useSyncExternalStore(subscribe, () => readPrefs(tenantId), () => null);
  const prefs = useMemo(() => raw ? parsePrefs(raw) : emptyPrefs, [raw]);
  return { prefs, favorite: (id: string) => writePrefs(tenantId, toggleFavorite(prefs, id)), opened: (id: string) => writePrefs(tenantId, touchViewed(prefs, id, Date.now())) };
}

/** The Forms list: templates, then a searchable, sortable table. Favorites and recents are per-browser conveniences. */
export function FormsList({ tenantId, forms, destinationLabels, backHref, backLabel }: { tenantId: string; forms: FormSummary[]; destinationLabels: Record<string, string>; backHref: string; backLabel: string }) {
  const t = useTranslations("CrmForms"), tt = useTranslations("CrmForms.templates"), format = useFormatter(), router = useRouter(), request = useCrmRequest();
  const { prefs, favorite, opened } = usePrefs(tenantId);
  const [query, setQuery] = useState(""), [sort, setSort] = useState<SortKey>("edited"), [error, setError] = useState("");
  const base = `/workspaces/${tenantId}/crm/forms`;
  const { hosted, slot } = useContextualSidebar({ title: t("forms"), back: { href: backHref, label: backLabel }, label: t("sidebar.label") });
  const byId = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);
  const favorites = prefs.favorites.flatMap((id) => byId.get(id) ?? []);
  const recent = recents(prefs).flatMap((id) => byId.get(id) ?? []);
  const where = (f: FormSummary) => f.destination ? (destinationLabels[f.destination.type === "pipeline" ? `pipeline:${f.destination.pipelineId}` : f.destination.type] ?? t("destination.unknown")) : t("destination.none");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = forms.filter((f) => !needle || f.title.toLowerCase().includes(needle));
    const when = (f: FormSummary) => sort === "opened" ? prefs.viewed[f.id] ?? 0 : Date.parse(sort === "created" ? f.createdAt : f.updatedAt);
    return [...list].sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : when(b) - when(a));
  }, [forms, query, sort, prefs.viewed]);

  async function duplicate(id: string) {
    setError("");
    const result = await request<{ id: string }>(`/api/workspaces/${tenantId}/crm/forms/${id}/duplicate`, { method: "POST" });
    if (!result.ok) { setError(result.error); return; }
    router.push(`${base}/${result.data.id}`);
  }

  const columns: DataTableColumn[] = [
    { id: "name", header: t("columns.name"), card: "title" }, { id: "savesTo", header: t("columns.savesTo"), showFrom: "@md" }, { id: "createdBy", header: t("columns.createdBy"), showFrom: "@lg" },
    { id: "viewed", header: t("columns.lastViewed"), showFrom: "@md" }, { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions", className: "w-24" },
  ];
  const tableRows: DataTableRow[] = rows.map((f) => {
    const starred = prefs.favorites.includes(f.id), viewed = prefs.viewed[f.id];
    return { id: f.id, label: f.title, cells: {
      name: <span className="flex min-w-0 items-center gap-2"><ClipboardList className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <Link href={`${base}/${f.id}`} onClick={() => opened(f.id)} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline">{f.title}</Link></span>,
      savesTo: where(f), createdBy: f.createdBy,
      viewed: viewed ? format.relativeTime(viewed) : t("neverViewed"),
      actions: <span className="flex items-center justify-end">
        <Button type="button" variant="ghost" size="icon" className="size-11" aria-pressed={starred} aria-label={starred ? t("row.unfavorite", { title: f.title }) : t("row.favorite", { title: f.title })} onClick={() => favorite(f.id)}><Star className={starred ? "fill-primary text-primary" : undefined} aria-hidden="true" /></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11" aria-label={t("row.menu", { title: f.title })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem className="min-h-11" onSelect={() => { opened(f.id); router.push(`${base}/${f.id}`); }}>{t("row.open")}</DropdownMenuItem>
            <DropdownMenuItem className="min-h-11" onSelect={() => void duplicate(f.id)}><Copy aria-hidden="true" />{t("row.duplicate")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></span>,
    } };
  });

  const panel = <nav aria-label={t("sidebar.label")} className="space-y-5 px-2 text-sm" data-forms-sidebar>
    <div><Link href={base} aria-current="page" className="flex min-h-11 items-center gap-2 rounded-md bg-accent px-3 font-medium"><ClipboardList className="size-4" aria-hidden="true" />{t("sidebar.all")}</Link></div>
    <section aria-labelledby="forms-fav"><h3 id="forms-fav" className="px-3 pb-1 text-xs font-medium text-muted-foreground">{t("sidebar.favorites")}</h3>
      {favorites.length === 0 ? <p className="px-3 py-2 text-muted-foreground">{t("sidebar.favoritesEmpty")}</p> : <ul>{favorites.map((f) => <li key={f.id}><Link href={`${base}/${f.id}`} onClick={() => opened(f.id)} className="flex min-h-11 items-center gap-2 truncate rounded-md px-3 hover:bg-accent"><Star className="size-4 fill-primary text-primary" aria-hidden="true" />{f.title}</Link></li>)}</ul>}</section>
    <section aria-labelledby="forms-recent"><h3 id="forms-recent" className="px-3 pb-1 text-xs font-medium text-muted-foreground">{t("sidebar.recents")}</h3>
      {recent.length === 0 ? <p className="px-3 py-2 text-muted-foreground">{t("sidebar.recentsEmpty")}</p> : <ul>{recent.map((f) => <li key={f.id}><Link href={`${base}/${f.id}`} onClick={() => opened(f.id)} className="flex min-h-11 items-center gap-2 truncate rounded-md px-3 hover:bg-accent"><ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />{f.title}</Link></li>)}</ul>}</section>
  </nav>;

  return <div className="min-w-0 space-y-6" data-forms-list>
    {hosted && slot ? createPortal(panel, slot) : null}
    <div className="grid min-w-0 gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
      {!hosted && <aside className="max-lg:hidden">{panel}</aside>}
      <div className={`min-w-0 space-y-6 ${hosted ? "lg:col-span-2" : ""}`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-[28px] font-semibold tracking-tight">{t("forms")}</h1>
          <Button asChild className="min-h-11"><Link href={`${base}/new`}><Plus aria-hidden="true" />{t("newForm")}</Link></Button></div>
        <section aria-labelledby="forms-templates" className="space-y-2"><h2 id="forms-templates" className="text-sm font-medium text-muted-foreground">{t("templatesHeading")}</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{templateIds.slice(0, 3).map((id) => { const Icon = templateIcon[id]; return <li key={id}>
            <Card className="p-0 transition-colors hover:bg-accent/40 focus-within:ring-[3px] focus-within:ring-ring/50"><Link href={`${base}/new?template=${id}`} data-template-card={id} className="flex min-h-16 items-center gap-3 rounded-xl p-4 outline-none">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="size-5" aria-hidden="true" /></span>
              <span className="min-w-0"><span className="block truncate font-semibold">{tt(`${id}.name`)}</span><span className="block truncate text-sm text-muted-foreground">{tt(`${id}.description`)}</span></span></Link></Card></li>; })}</ul></section>
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DataTable label={t("tableLabel")} columns={columns} rows={tableRows} bordered
          toolbar={{ search: <div className="flex items-center gap-2 rounded-md border px-3 focus-within:ring-[3px] focus-within:ring-ring/50"><Search className="size-4 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} aria-label={t("searchLabel")} className="h-11 border-0 px-0 shadow-none focus-visible:ring-0" /></div>,
            filters: <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="min-h-11"><ArrowUpDown aria-hidden="true" />{t("sort.label")}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="start"><DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as SortKey)}>{sortKeys.map((key) => <DropdownMenuRadioItem key={key} value={key} className="min-h-11">{t(`sort.${key}`)}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu> }}
          empty={<EmptyState icon={ClipboardList} title={forms.length === 0 ? t("empty.title") : t("empty.noMatch")} size="compact" action={forms.length === 0 ? <Button asChild className="min-h-11"><Link href={`${base}/new`}>{t("newForm")}</Link></Button> : undefined} />} />
      </div>
    </div>
  </div>;
}
