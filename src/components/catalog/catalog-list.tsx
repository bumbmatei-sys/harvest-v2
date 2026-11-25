/** Layout and behaviour modelled on bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/pages/products/product-list.tsx; code written for Harvest, no kit code copied. Harvest notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ExternalLink, PackageOpen, Pencil, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { CatalogTypeArt } from "@/components/catalog/catalog-type-art";
import { useRequest } from "@/hooks/use-request";
import { publicPath, stateTone, type CatalogKind, type CatalogRow } from "@/lib/catalog";

type KindFilter = "all" | CatalogKind;
const pageSize = 50;

/**
 * The ministry's courses and products on the shared DataTable: a type tab (when the list is not already one type), a search over the loaded rows, a
 * status badge, and the editor and the public page as row actions. The server pages by item id (50 at a time), so "Load more" follows its cursor.
 * Members and viewers see the same rows and no create or edit control.
 */
export function CatalogList({ tenantId, kind, initial, canManage }: { tenantId: string; kind: KindFilter; initial: CatalogRow[]; canManage: boolean }) {
  const t = useTranslations("Catalog"), request = useRequest(), format = useFormatter();
  const [rows, setRows] = useState(initial), [more, setMore] = useState(initial.length === pageSize), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [tab, setTab] = useState<KindFilter>(kind), [query, setQuery] = useState("");
  const root = `/workspaces/${tenantId}/products`;
  const newHref = kind === "all" ? `${root}/new` : `${root}/new/${kind}`;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (tab === "all" || row.kind === tab) && (!needle || `${row.title} ${row.slug}`.toLowerCase().includes(needle)));
  }, [rows, tab, query]);

  async function loadMore() {
    setLoading(true); setError("");
    const result = await request<CatalogRow[]>(`/api/workspaces/${tenantId}/catalog?after=${rows.at(-1)?.id ?? ""}`, { method: "GET" });
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    setRows((current) => [...current, ...result.data]); setMore(result.data.length === pageSize);
  }

  const columns: DataTableColumn[] = [
    { id: "title", header: t("columns.title"), card: "title" },
    { id: "kind", header: t("columns.kind"), showFrom: "@md" },
    { id: "state", header: t("columns.status") },
    { id: "visibility", header: t("columns.visibility"), showFrom: "@lg" },
    { id: "updated", header: t("columns.updated"), showFrom: "@3xl" },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const tableRows: DataTableRow[] = shown.map((row) => ({
    id: row.id, label: row.title,
    cells: {
      title: <span className="flex min-w-0 items-center gap-3">
        <CatalogTypeArt kind={row.kind} variant="cover" className="size-10 shrink-0 rounded-lg border" />
        <span className="min-w-0"><Link href={`${root}/${row.id}`} className="block truncate font-medium underline-offset-4 hover:underline">{row.title}</Link>
          <span className="block truncate text-xs text-muted-foreground" dir="ltr">{publicPath(row.kind, row.slug)}</span></span></span>,
      kind: t(`kinds.${row.kind}`),
      state: <StatusBadge tone={stateTone(row.state)} label={t(`states.${row.state}`)} dot />,
      visibility: t(`visibilities.${row.visibility}`),
      updated: format.dateTime(new Date(row.updatedAt), { dateStyle: "medium" }),
      actions: <>
        <Button asChild variant="outline" size="sm"><Link href={`${root}/${row.id}`}><Pencil aria-hidden="true" />{t(canManage ? "edit" : "view")}<span className="sr-only"> {row.title}</span></Link></Button>
        {row.state === "published" && <Button asChild variant="ghost" size="sm"><Link href={publicPath(row.kind, row.slug)} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{t("openPage")}<span className="sr-only"> {row.title}</span></Link></Button>}
      </>,
    },
  }));

  const create = canManage ? <Button asChild className="min-h-11 lg:min-h-9"><Link href={newHref}><Plus aria-hidden="true" />{t(kind === "course" ? "newCourse" : "newProduct")}</Link></Button> : null;
  const none = rows.length === 0;
  return <div className="min-w-0 space-y-4">
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {none
      ? <EmptyState icon={PackageOpen} title={t(kind === "course" ? "emptyCourses" : "emptyProducts")} description={canManage ? t("emptyDescription") : undefined} action={create ?? undefined} solid />
      : <DataTable label={t(kind === "course" ? "coursesLabel" : "productsLabel")} columns={columns} rows={tableRows}
        toolbar={{
          search: <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("search")} placeholder={t("search")} className="min-h-11 ps-9 lg:min-h-9" /></div>,
          actions: create,
        }}
        tabs={kind === "all" ? { label: t("kindTabs"), value: tab, onValueChange: (value) => setTab(value as KindFilter),
          items: [{ value: "all", label: t("tabs.all") }, { value: "course", label: t("tabs.course") }, { value: "download", label: t("tabs.download") }] } : undefined}
        empty={<EmptyState icon={Search} title={t("noMatches")} size="compact" />}
        pagination={more ? <div className="flex justify-center"><Button type="button" variant="outline" className="min-h-11" disabled={loading} onClick={() => void loadMore()}>{loading && <Spinner decorative size="sm" />}{t("loadMore")}</Button></div> : undefined} />}
  </div>;
}
