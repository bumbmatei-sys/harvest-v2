/** Layout and behaviour modelled on Shadcn UI Kit items tables14 (the shared DataTable already derived from it), switch-card1 and dashboard-dropdown7, approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { useFormatter, useTranslations } from "next-intl";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/lib/status-tone";
import { aggregate, appliesTo, columnGroups, columnIds, deliveryOf, statusSwitchable, type ColumnGroup, type ColumnId, type DeliveryKey, type Entity, type ResultsRow, type Tab } from "@/lib/ads/view";
import { totalsFor } from "@/lib/ads/view";
import type { ResultMetrics } from "@/lib/ads/ads";

const tone: Record<DeliveryKey, StatusTone> = { active: "success", off: "neutral", completed: "neutral", inReview: "pending", rejected: "danger", issue: "warning", notDelivering: "warning", archived: "neutral" };
const align = new Set<ColumnId>(["budget", "results", "costPerResult", "reach", "impressions", "spend", "clicks", "ctr", "cpc", "cpm"]);

/** The columns picker: the four sets (Performance, Delivery, Engagement, Custom) and, for Custom, one checkbox per column. */
export function ColumnsMenu({ group, custom, onGroup, onCustom }: { group: ColumnGroup; custom: readonly ColumnId[]; onGroup: (group: ColumnGroup) => void; onCustom: (columns: ColumnId[]) => void }) {
  const cm = useTranslations("Ads.columns");
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="responsive"><Columns3 aria-hidden="true" />{cm("label")}</Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuLabel>{cm("sets")}</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={group} onValueChange={(value) => onGroup(value as ColumnGroup)}>
        {columnGroups.map((id) => <DropdownMenuRadioItem key={id} value={id} className="min-h-11 lg:min-h-0">{cm(`group.${id}`)}</DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      {group === "custom" && <>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{cm("choose")}</DropdownMenuLabel>
        {columnIds.map((id) => <DropdownMenuCheckboxItem key={id} checked={custom.includes(id)} onSelect={(event) => event.preventDefault()} className="min-h-11 lg:min-h-0"
          onCheckedChange={(on) => onCustom(on ? [...custom, id] : custom.filter((item) => item !== id))}>{cm(`column.${id}`)}</DropdownMenuCheckboxItem>)}
      </>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export type AdsTableProps = {
  tab: Tab; rows: readonly Entity[]; results: readonly ResultsRow[]; currency: string; today: string; columns: readonly ColumnId[];
  selected: readonly string[]; onSelect: (ids: string[]) => void; tabs: { value: Tab; onChange: (tab: Tab) => void; counts: Record<Tab, number> };
  onToggle: (row: Entity, on: boolean) => void; onOpen: (row: Entity) => void; busyId: string | null; writable: boolean;
  toolbar: React.ReactNode; bulk: React.ReactNode; loading: boolean; empty: React.ReactNode;
};

export function AdsTable(p: AdsTableProps) {
  const t = useTranslations("Ads.table"), c = useTranslations("Ads.columns"), l = useTranslations("Ads"), format = useFormatter();
  const sums = aggregate(p.results), level = p.rows[0]?.level ?? (p.tab === "campaigns" ? "campaign" : p.tab === "adsets" ? "adset" : "ad");
  const money = (v: number | undefined, digits = 2) => v === undefined ? null : format.number(v, { style: "currency", currency: p.currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
  const count = (v: number | undefined) => v === undefined ? null : format.number(Math.round(v));
  const percent = (v: number | undefined) => v === undefined ? null : format.number(v, { style: "percent", maximumFractionDigits: 2 });
  const day = (v: string | null) => v ? format.dateTime(new Date(`${v}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : null;
  const unavailable = <span className="text-muted-foreground" title={t("unavailable")}>{t("dash")}<span className="sr-only">{t("unavailable")}</span></span>;
  const show = (value: string | null) => value ?? unavailable;
  const budgetOf = (row: Entity) => {
    if (row.level === "ad") return unavailable;
    if (row.level === "campaign" && row.budgetOn === "adset") return <span className="text-muted-foreground">{t("adSetBudget")}</span>;
    if (row.budgetAmount === null) return unavailable;
    return t(row.budgetType === "lifetime" ? "lifetime" : "daily", { amount: money(row.budgetAmount) ?? "" });
  };
  const metric = (row: Entity, id: ColumnId, m: ResultMetrics) => {
    switch (id) {
      case "results": return show(count(m.results));
      case "costPerResult": return show(money(m.costPerResult));
      case "reach": return show(count(m.reach));
      case "impressions": return show(count(m.impressions));
      case "spend": return show(money(m.spend));
      case "clicks": return show(count(m.clicks));
      case "ctr": return show(percent(m.ctr));
      case "cpc": return show(money(m.cpc));
      case "cpm": return show(money(m.cpm));
      default: return null;
    }
  };
  const header = (id: ColumnId) => id === "reach" ? c("column.reachDay") : c(`column.${id}`);
  const shown = p.columns.filter((id) => appliesTo(id, level));

  const columns: DataTableColumn[] = [
    { id: "toggle", header: t("onOff"), srOnlyHeader: true, className: "w-14", card: "actions" },
    { id: "name", header: t("name"), card: "title", className: "min-w-56" },
    ...shown.map((id): DataTableColumn => ({ id, header: header(id), align: align.has(id) ? "end" : "start", className: align.has(id) ? "whitespace-nowrap" : undefined })),
  ];
  const rows: DataTableRow[] = p.rows.map((row) => {
    const m = sums.get(row.id)?.metrics ?? {}, delivery = deliveryOf(row, p.today);
    const cells: Record<string, React.ReactNode> = {
      toggle: statusSwitchable(row)
        ? <label className="flex min-h-11 min-w-11 items-center justify-center lg:min-h-8"><Switch checked={row.status === "active"} disabled={!p.writable || p.busyId === row.id} aria-label={t("switchLabel", { name: row.name })} onCheckedChange={(on) => p.onToggle(row, on)} /></label>
        : <span className="sr-only">{t("notSwitchable")}</span>,
      name: <div className="min-w-0"><button type="button" className="min-h-11 max-w-full truncate rounded-sm text-start font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:min-h-0" onClick={() => p.onOpen(row)} data-ads-open={row.id}>{row.name}</button>
        {(row.parentName || (row.level === "ad" && (row.reviewStatus === "rejected" || row.reviewStatus === "in_review"))) && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {row.parentName && <span className="truncate">{row.parentName}</span>}
          {row.level === "ad" && row.reviewStatus === "rejected" && <StatusBadge tone="danger" label={l("review.rejected")} />}
          {row.level === "ad" && row.reviewStatus === "in_review" && <StatusBadge tone="pending" label={l("review.in_review")} />}
        </div>}</div>,
      delivery: <StatusBadge tone={tone[delivery]} dot label={l(`delivery.${delivery}`)} />,
      budget: budgetOf(row),
      ends: row.endDate ? day(row.endDate) : <span className="text-muted-foreground">{t("ongoing")}</span>,
      starts: show(day(row.startDate)),
      goal: row.goal ? l(`goals.${row.goal}`) : unavailable,
      bidding: show(row.bidding ? l(`bidding.${row.bidding.split(":")[0]}`) : null),
      format: row.format ? l(`formats.${row.format}`) : unavailable,
      review: row.reviewStatus ? l(`review.${row.reviewStatus}`) : unavailable,
    };
    for (const id of shown) if (!(id in cells)) cells[id] = metric(row, id, m);
    return { id: row.id, label: row.name, cells };
  });
  const totals = totalsFor(p.results, new Set(p.rows.map((row) => row.id)));
  const totalCells: Record<string, React.ReactNode> = {};
  for (const id of shown) totalCells[id] = id === "budget" || id === "delivery" || id === "ends" || id === "starts" || id === "goal" || id === "bidding" || id === "format" || id === "review" ? "" : metric(p.rows[0] ?? ({} as Entity), id, totals);
  const items = [{ value: "campaigns", label: l("tabs.campaigns"), count: p.tabs.counts.campaigns }, { value: "adsets", label: l("tabs.adsets"), count: p.tabs.counts.adsets }, { value: "ads", label: l("tabs.ads"), count: p.tabs.counts.ads }];
  return <DataTable label={t(`label.${p.tab}`)} columns={columns} rows={rows} state={p.loading ? "loading" : "ready"} fixed={false}
    totals={p.rows.length ? { label: t("totals", { count: p.rows.length }), cells: totalCells } : undefined}
    tabs={{ label: l("tabs.label"), value: p.tab, onValueChange: (value) => p.tabs.onChange(value as Tab), items }}
    selection={{ selected: p.selected, onChange: p.onSelect }} bulk={{ label: t("bulk"), actions: p.bulk }}
    toolbar={{ actions: p.toolbar }} empty={p.empty} />;
}
