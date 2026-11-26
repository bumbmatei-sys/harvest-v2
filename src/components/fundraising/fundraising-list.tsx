"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { HandCoins, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { FundraisingFormDialog } from "@/components/fundraising/giving-dialogs";
import { formatCents, fundraisingTone, progressPercent, type FundraisingRow } from "@/lib/fundraising";

/**
 * The ministry's fundraising campaigns on the shared DataTable: status, goal and, for owners and admins, raised (gifts confirmed by the ministry) and
 * progress. Creating opens the shared form dialog; a new campaign opens its page.
 */
export function FundraisingList({ tenantId, rows, canManage, campaigns }: { tenantId: string; rows: FundraisingRow[]; canManage: boolean; campaigns: { id: string; name: string }[] }) {
  const t = useTranslations("Fundraising"), locale = useLocale(), router = useRouter();
  const [query, setQuery] = useState("");
  const root = `/workspaces/${tenantId}/giving/fundraising`, endpoint = `/api/workspaces/${tenantId}/fundraising`;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => `${row.title} ${row.campaignName ?? ""}`.toLowerCase().includes(needle)) : rows;
  }, [rows, query]);
  const showRaised = rows.some((row) => row.totals);
  const columns: DataTableColumn[] = [
    { id: "title", header: t("columns.title"), card: "title" },
    { id: "status", header: t("columns.status") },
    { id: "goal", header: t("columns.goal"), align: "end", showFrom: "@md" },
    ...(showRaised ? [{ id: "raised", header: t("columns.raised"), align: "end" } as const, { id: "progress", header: t("columns.progress"), align: "end", showFrom: "@lg" } as const] : []),
    { id: "actions", header: t("columns.actions"), srOnlyHeader: true, align: "end", card: "actions" },
  ];
  const tableRows: DataTableRow[] = shown.map((row) => ({
    id: row.id, label: row.title,
    cells: {
      title: <span className="min-w-0"><Link href={`${root}/${row.id}`} className="block truncate font-medium underline-offset-4 hover:underline">{row.title}</Link>
        {row.campaignName && <span className="block truncate text-xs text-muted-foreground">{row.campaignName}</span>}</span>,
      status: <StatusBadge tone={fundraisingTone(row.status)} label={t(`statuses.${row.status}`)} dot />,
      goal: <span className="tabular-nums">{formatCents(row.goalCents, row.currency, locale)}</span>,
      raised: row.totals ? <span className="tabular-nums">{formatCents(row.totals.raisedCents, row.currency, locale)}</span> : null,
      progress: row.totals ? <span className="tabular-nums">{t("stats.ofGoal", { percent: progressPercent(row.totals.raisedCents, row.goalCents) })}</span> : null,
      actions: <Button asChild variant="outline" size="sm"><Link href={`${root}/${row.id}`}>{t("view")}<span className="sr-only"> {row.title}</span></Link></Button>,
    },
  }));
  const create = canManage ? <FundraisingFormDialog endpoint={endpoint} campaigns={campaigns} onSaved={(row) => router.push(`${root}/${row.id}`)}
    trigger={<Button type="button" className="min-h-11 lg:min-h-9"><Plus aria-hidden="true" />{t("new")}</Button>} /> : null;
  if (!rows.length) return <EmptyState icon={HandCoins} title={t("empty")} description={canManage ? t("emptyDescription") : undefined} action={create ?? undefined} solid />;
  return <DataTable label={t("listLabel")} columns={columns} rows={tableRows}
    toolbar={{
      search: <div className="relative"><Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("search")} placeholder={t("search")} className="min-h-11 ps-9 lg:min-h-9" /></div>,
      actions: create,
    }}
    empty={<EmptyState icon={Search} title={t("noMatches")} size="compact" />} />;
}
