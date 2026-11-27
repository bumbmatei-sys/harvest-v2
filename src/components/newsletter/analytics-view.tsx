"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChartLine, ContactRound } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ReportPeriodTabs } from "@/components/crm/reports/report-period-tabs";
import { ReportStatCards, type ReportStat } from "@/components/crm/reports/report-stat-cards";
import { ReportTrendCard } from "@/components/crm/reports/report-trend-card";
import { analyticsPeriods, percent, sortCampaigns, type AnalyticsOverview, type AnalyticsPeriod, type AnalyticsSort, type Counts } from "@/lib/newsletter-analytics";
import { defineStatusTones } from "@/lib/status-tone";

const tone = defineStatusTones({ sending: "pending", sent: "success", partial: "warning", cancelled: "neutral", failed: "danger" });
const figureColumns = ["sent", "delivered", "bounced", "complained", "unsubscribed"] as const;
const clickSeriesColor = "var(--chart-3)";

/**
 * Newsletter analytics: aggregates only. Period tabs, summary tiles, a daily chart and a sortable campaign table, all on the shared report and
 * table components. A figure the server withheld (a group of fewer than 5) arrives as null and reads "Fewer than 5"; it is never zero.
 */
export function AnalyticsView({ tenantId, overview }: { tenantId: string; overview: AnalyticsOverview }) {
  const t = useTranslations("NewsletterAnalytics"), campaignT = useTranslations("NewsletterCampaigns"), crm = useTranslations("CrmReports"), format = useFormatter(), router = useRouter();
  const [sort, setSort] = useState<{ key: AnalyticsSort; descending: boolean }>({ key: "sent", descending: true });
  const { totals, days, audience, clicks } = overview, base = `/workspaces/${tenantId}/newsletter`;
  const num = (value: number | null) => value === null ? null : format.number(value);
  const rate = (part: number | undefined, whole: number | undefined) => {
    const value = part === undefined || whole === undefined ? null : percent(part, whole);
    return value === null ? undefined : t("rateOfSent", { rate: format.number(value, { maximumFractionDigits: 1 }) });
  };
  const ratio = (part: number | undefined, whole: number | undefined) => part === undefined || !whole ? 0 : Math.min(1, part / whole);
  const stats: ReportStat[] = [
    { id: "campaigns", name: t("tiles.campaigns"), value: format.number(overview.campaigns.length), color: "bg-chart-1" },
    { id: "sent", name: t("tiles.sent"), value: num(totals?.sent ?? null), color: "bg-chart-2" },
    { id: "delivered", name: t("tiles.delivered"), value: num(totals?.delivered ?? null), color: "bg-chart-3", ratio: ratio(totals?.delivered, totals?.sent), target: rate(totals?.delivered, totals?.sent) },
    { id: "bounced", name: t("tiles.bounced"), value: num(totals?.bounced ?? null), color: "bg-chart-4", ratio: ratio(totals?.bounced, totals?.sent), target: rate(totals?.bounced, totals?.sent) },
    { id: "complained", name: t("tiles.complained"), value: num(totals?.complained ?? null), color: "bg-chart-5", ratio: ratio(totals?.complained, totals?.sent), target: rate(totals?.complained, totals?.sent) },
    { id: "unsubscribed", name: t("tiles.unsubscribed"), value: num(totals?.unsubscribed ?? null), color: "bg-chart-1", ratio: ratio(totals?.unsubscribed, totals?.sent), target: rate(totals?.unsubscribed, totals?.sent) },
    // Clicks are totals only and may include link scanners; never unique readers.
    { id: "clicks", name: t("tiles.clicks"), value: !clicks.counting && clicks.total === 0 ? t("clicksOff") : num(clicks.total), target: t("clicksNote"), color: "bg-chart-3" },
  ];
  const showClicks = clicks.counting || clicks.total !== 0;
  // The server returns a null total when any day was a small group; a period with no records at all reads as quiet.
  const quiet = overview.campaigns.length === 0 && clicks.total === 0 && (totals === null ? days.every((day) => day.counts?.sent === 0) : totals.sent === 0 && totals.delivered === 0);
  const series = [
    { key: "sent", label: t("tiles.sent"), color: "var(--chart-1)" }, { key: "delivered", label: t("tiles.delivered"), color: "var(--chart-2)" },
    { key: "bounced", label: t("tiles.bounced"), color: "var(--chart-4)" }, { key: "unsubscribed", label: t("tiles.unsubscribed"), color: "var(--chart-5)" },
    ...(showClicks ? [{ key: "clicks", label: t("tiles.clicks"), color: clickSeriesColor }] : []),
  ];
  const clicksByDay = new Map(clicks.days.map((day) => [day.day, day.clicks]));
  const points = days.map((day) => ({ day: day.day, values: Object.fromEntries(series.map((item) => [item.key, item.key === "clicks" ? clicksByDay.get(day.day) ?? 0
    : day.counts ? day.counts[item.key as keyof Counts] : null])) }));

  const header = (key: AnalyticsSort, label: string, extra: Partial<DataTableColumn> = {}): DataTableColumn => ({ id: key, header: label, ...extra,
    sort: { direction: sort.key === key ? (sort.descending ? "descending" : "ascending") : "none", onSort: () => setSort((current) => ({ key, descending: current.key === key ? !current.descending : key !== "name" })) } });
  const columns: DataTableColumn[] = [
    header("name", t("table.campaign"), { card: "title" }), { id: "status", header: t("table.status"), showFrom: "@md" },
    ...figureColumns.map((key) => header(key, t(`tiles.${key}`), { align: "end" as const, showFrom: key === "complained" ? "@lg" as const : undefined })),
    ...(showClicks ? [header("clicks", t("tiles.clicks"), { align: "end" as const, showFrom: "@lg" as const })] : []),
  ];
  const cell = (value: number | null | undefined) => value === null || value === undefined
    ? <span className="text-muted-foreground" data-testid="report-hidden">{crm("hidden")}</span> : <span className="tabular-nums">{format.number(value)}</span>;
  const rows: DataTableRow[] = sortCampaigns(overview.campaigns, sort.key, sort.descending).map((campaign) => ({ id: campaign.id, label: campaign.name, cells: {
    name: <Link href={`${base}/analytics/${campaign.id}`} className="flex min-h-11 min-w-0 items-center truncate font-medium hover:underline">{campaign.name}</Link>,
    status: <StatusBadge tone={tone(campaign.state)} label={campaignT(`status.${campaign.state as "sent"}`)} />,
    ...Object.fromEntries(figureColumns.map((key) => [key, cell(campaign.counts ? campaign.counts[key] : null)])),
    clicks: cell(campaign.clicks ?? 0),
  } }));
  const date = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", dateStyle: "medium" });

  return <div className="flex min-w-0 flex-col gap-6" data-testid="newsletter-analytics" data-period={overview.period}>
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><ChartLine className="size-3.5" aria-hidden="true" />{t("eyebrow")}</div>
        <h1 className="text-[28px] font-semibold tracking-tight">{t("heading")}</h1>
      </div>
      <ReportPeriodTabs<`${AnalyticsPeriod}`> value={`${overview.period}`} periods={analyticsPeriods.map(String) as `${AnalyticsPeriod}`[]} ariaLabel={t("period")}
        labelOf={(period) => t("periods", { days: Number(period) })} onValueChange={(next) => router.push(`${base}/analytics?period=${next}`, { scroll: false })} />
    </header>
    <ReportStatCards stats={stats} columns={4} />
    {quiet ? <EmptyState icon={ChartLine} title={t("empty.title")} description={t("empty.description")} solid headingLevel={2} /> : <>
      <ReportTrendCard id="daily" title={t("daily.title")} caption={t("daily.caption")} dayHeader={t("daily.day")} points={points} series={series} />
      <Card data-testid="campaign-figures">
        <CardHeader><CardTitle>{t("table.title")}</CardTitle></CardHeader>
        <CardContent>
          <DataTable bordered={false} label={t("table.title")} columns={columns} rows={rows} note={overview.campaignsTruncated ? t("table.truncated", { count: 50 }) : undefined} />
        </CardContent>
      </Card>
    </>}
    <Card data-testid="audience-now">
      <CardHeader>
        <CardTitle>{t("audience.title")}</CardTitle>
        <CardDescription><Link href={`${base}/audience`} className="inline-flex min-h-11 items-center gap-1.5 hover:underline lg:min-h-0"><ContactRound className="size-3.5" aria-hidden="true" />{t("audience.open")}</Link></CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(["subscribed", "unsubscribed", "suppressed"] as const).map((key) => <div key={key} className="flex flex-col gap-1" data-metric={key}>
            <dt className="text-sm text-muted-foreground">{t(`audience.${key}`)}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{audience[key] === null ? <span className="text-muted-foreground text-lg" data-testid="report-hidden">{crm("hidden")}</span> : format.number(audience[key])}</dd>
          </div>)}
        </dl>
      </CardContent>
    </Card>
    <footer className="text-xs text-muted-foreground" data-testid="analytics-footer">
      <p>{t("footer", { days: overview.period, start: date(overview.range.from), end: date(overview.generatedAt.slice(0, 10)), clicks: t(clicks.counting ? "clicksFooter.on" : "clicksFooter.off") })}</p>
    </footer>
  </div>;
}
