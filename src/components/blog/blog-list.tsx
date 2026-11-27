/** Layout reference: Shadcn UI Kit item tables8 (premium, founder-approved 27 Nov 2026), used as a layout reference only; built on the shared DataTable, StatusBadge, EmptyState and ConfirmDialog. Notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarX2, ExternalLink, Link2, MoreHorizontal, Newspaper, Pencil, Plus, Search, Settings2, Trash2, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { BlogSettingsDialog } from "@/components/blog/blog-settings-dialog";
import { useRequest } from "@/hooks/use-request";
import { blogPath, type BlogStatus } from "@/lib/blog";
import { formatScheduled } from "@/lib/newsletter-schedule";
import type { StatusTone } from "@/lib/status-tone";
import { notify } from "@/lib/toast";
import type { BlogListRow, BlogOwnerPost, BlogOwnerSettings } from "@/server/blog";

type Tab = "all" | BlogStatus;
const tone: Record<BlogStatus, StatusTone> = { draft: "pending", scheduled: "info", published: "success" };
type Pending = { kind: "delete" | "unpublish"; row: BlogListRow } | null;

/** The ministry's articles: status tabs with counts, a search over titles and addresses, and Edit plus a menu (View, Copy link, Unschedule, Unpublish, Delete). */
export function BlogList({ tenantId, initial }: { tenantId: string; initial: { settings: BlogOwnerSettings; posts: BlogListRow[] } }) {
  const t = useTranslations("Blog"), format = useFormatter(), request = useRequest(), router = useRouter();
  const [settings, setSettings] = useState(initial.settings), [rows, setRows] = useState(initial.posts);
  const [tab, setTab] = useState<Tab>("all"), [query, setQuery] = useState(""), [creating, setCreating] = useState(false), [error, setError] = useState("");
  const [pending, setPending] = useState<Pending>(null), [settingsOpen, setSettingsOpen] = useState(false);
  const api = `/api/workspaces/${tenantId}/blog`, root = `/workspaces/${tenantId}/blog`;
  const counts = useMemo(() => ({ all: rows.length, draft: rows.filter((r) => r.status === "draft").length, scheduled: rows.filter((r) => r.status === "scheduled").length, published: rows.filter((r) => r.status === "published").length }), [rows]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((r) => (tab === "all" || r.status === tab) && (!needle || `${r.title} ${r.slug}`.toLowerCase().includes(needle)));
  }, [rows, tab, query]);

  async function create() {
    setCreating(true); setError("");
    const result = await request<BlogOwnerPost>(`${api}/posts`, { method: "POST", body: {} });
    if (!result.ok) { setCreating(false); setError(result.error); return; }
    router.push(`${root}/${result.data.id}`);
  }
  async function change(row: BlogListRow, action: "unschedule" | "unpublish") {
    const current = await request<{ post: BlogOwnerPost }>(`${api}/posts/${row.id}`, { method: "GET" });
    if (!current.ok) { setError(current.error); return false; }
    const result = await request<BlogOwnerPost>(`${api}/posts/${row.id}/state`, { method: "POST", body: { action, version: current.data.post.version } });
    if (!result.ok) { setError(result.error); return false; }
    setRows((list) => list.map((r) => r.id === row.id ? { ...r, status: result.data.status, publishAt: result.data.publishAt, publishedAt: result.data.publishedAt, updatedAt: result.data.updatedAt } : r));
    notify.success(t(action === "unpublish" ? "unpublished" : "unscheduled"));
    return true;
  }
  async function remove(row: BlogListRow) {
    const current = await request<{ post: BlogOwnerPost }>(`${api}/posts/${row.id}`, { method: "GET" });
    if (!current.ok) return false;
    const result = await request(`${api}/posts/${row.id}?version=${current.data.post.version}`, { method: "DELETE" });
    if (!result.ok) return false;
    setRows((list) => list.filter((r) => r.id !== row.id)); notify.success(t("deleted"));
    return true;
  }
  const copy = async (row: BlogListRow) => { try { await navigator.clipboard.writeText(new URL(blogPath(settings.handle, row.slug), location.origin).href); notify.success(t("linkCopied")); } catch { /* the browser refused; nothing to do */ } };
  const when = (row: BlogListRow) => row.status === "scheduled" && row.publishAt ? formatScheduled(row.publishAt, settings.timeZone)
    : row.status === "published" && row.publishedAt ? format.dateTime(new Date(row.publishedAt), { dateStyle: "medium" })
    : t("when.draft", { date: format.dateTime(new Date(row.updatedAt), { dateStyle: "medium" }) });

  const columns: DataTableColumn[] = [
    { id: "title", header: t("columns.title"), card: "title" },
    { id: "status", header: t("columns.status") },
    { id: "date", header: t("columns.date"), showFrom: "@md" },
    { id: "author", header: t("columns.author"), showFrom: "@lg" },
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const tableRows: DataTableRow[] = shown.map((row) => {
    const title = row.title || t("untitled");
    return { id: row.id, label: title, cells: {
      title: <span className="block min-w-0"><Link href={`${root}/${row.id}`} className="block truncate font-medium underline-offset-4 hover:underline">{title}</Link>
        <span className="block truncate text-xs text-muted-foreground" dir="ltr">{blogPath(settings.handle, row.slug)}</span></span>,
      status: <StatusBadge tone={tone[row.status]} label={t(`status.${row.status}`)} dot />,
      date: <span className="text-sm">{when(row)}</span>,
      author: <span className="text-sm text-muted-foreground">{row.author ?? ""}</span>,
      actions: <div className="flex items-center justify-end gap-1">
        <Button asChild variant="outline" size="sm"><Link href={`${root}/${row.id}`}><Pencil aria-hidden="true" />{t("edit")}<span className="sr-only"> {title}</span></Link></Button>
        <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("more", { title })}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {row.status === "published" && <DropdownMenuItem asChild className="min-h-11 lg:min-h-8"><Link href={blogPath(settings.handle, row.slug)} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{t("view")}</Link></DropdownMenuItem>}
            {row.status === "published" && <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => void copy(row)}><Link2 aria-hidden="true" />{t("copyLink")}</DropdownMenuItem>}
            {row.status === "scheduled" && <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => void change(row, "unschedule")}><CalendarX2 aria-hidden="true" />{t("unschedule")}</DropdownMenuItem>}
            {row.status === "published" && <DropdownMenuItem className="min-h-11 lg:min-h-8" onSelect={() => setPending({ kind: "unpublish", row })}><Undo2 aria-hidden="true" />{t("unpublish")}</DropdownMenuItem>}
            {row.status !== "draft" && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" className="min-h-11 lg:min-h-8" onSelect={() => setPending({ kind: "delete", row })}><Trash2 aria-hidden="true" />{t("delete")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
      </div>,
    } };
  });

  const newButton = <Button type="button" className="min-h-11 lg:min-h-9" disabled={creating} onClick={() => void create()}>{creating ? <Spinner decorative size="sm" /> : <Plus aria-hidden="true" />}{creating ? t("creating") : t("newArticle")}</Button>;
  return <div className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="min-h-11 lg:min-h-9" onClick={() => setSettingsOpen(true)}><Settings2 aria-hidden="true" />{t("settings")}</Button>
        {counts.published > 0 && <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><Link href={blogPath(settings.handle)} target="_blank" rel="noopener"><ExternalLink aria-hidden="true" />{t("viewBlog")}</Link></Button>}
        {rows.length > 0 && newButton}
      </div>
    </div>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    {rows.length === 0
      ? <EmptyState icon={Newspaper} title={t("empty")} description={t("emptyDescription")} action={newButton} solid />
      : <DataTable label={t("listLabel")} columns={columns} rows={tableRows}
        toolbar={{ search: <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("search")} placeholder={t("search")} className="min-h-11 ps-9 lg:min-h-9" /></div> }}
        tabs={{ label: t("tabsLabel"), value: tab, onValueChange: (value) => setTab(value as Tab), items: (["all", "draft", "scheduled", "published"] as const).map((value) => ({ value, label: t(`tabs.${value}`), count: counts[value] })) }}
        empty={<EmptyState icon={Search} title={t("noMatches")} size="compact" />} />}
    <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} tone={pending?.kind === "delete" ? "destructive" : "neutral"}
      title={t(pending?.kind === "unpublish" ? "unpublishTitle" : "deleteTitle")} description={t(pending?.kind === "unpublish" ? "unpublishBody" : "deleteBody")}
      confirmLabel={t(pending?.kind === "unpublish" ? "unpublishConfirm" : "deleteConfirm")} cancelLabel={t("cancel")} busyLabel={t("saving")}
      onConfirm={async () => { if (!pending) return; const ok = pending.kind === "delete" ? await remove(pending.row) : await change(pending.row, "unpublish"); if (!ok) return t("deleteFailed"); setPending(null); }} />
    <BlogSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} tenantId={tenantId} settings={settings} onSaved={setSettings} />
  </div>;
}
