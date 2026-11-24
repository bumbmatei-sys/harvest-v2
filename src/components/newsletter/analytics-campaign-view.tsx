"use client";

import Link from "next/link";
import { ArrowLeft, MailPlus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { ReportBarsCard } from "@/components/crm/reports/report-bars-card";
import { ReportStatCards, type ReportStat } from "@/components/crm/reports/report-stat-cards";
import { ReportTrendCard } from "@/components/crm/reports/report-trend-card";
import { percent, type CampaignAnalytics } from "@/lib/newsletter-analytics";
import { defineStatusTones } from "@/lib/status-tone";

const tone = defineStatusTones({ draft: "neutral", reviewed: "info", scheduled: "pending", sending: "pending", sent: "success", partial: "warning", cancelled: "neutral", failed: "danger" });

/** One campaign's analytics on the shared report tiles, trend card and bars card. Aggregates only; a withheld figure reads "Fewer than 5". */
export function AnalyticsCampaignView({ tenantId, data }: { tenantId: string; data: CampaignAnalytics }) {
  const t = useTranslations("NewsletterAnalytics"), campaignT = useTranslations("NewsletterCampaigns"), format = useFormatter();
  const base = `/workspaces/${tenantId}/newsletter`, { totals, status } = data;
  const num = (value: number | null | undefined) => value === null || value === undefined ? null : format.number(value);
  const rate = (part: number | undefined) => {
    const value = part === undefined || !totals ? null : percent(part, totals.sent);
    return value === null ? undefined : t("rateOfSent", { rate: format.number(value, { maximumFractionDigits: 1 }) });
  };
  const ratio = (part: number | undefined) => part === undefined || !totals?.sent ? 0 : Math.min(1, part / totals.sent);
  const stats: ReportStat[] = [
    { id: "selected", name: t("tiles.selected"), value: num(status?.selected), color: "bg-chart-1" },
    { id: "sent", name: t("tiles.sent"), value: num(totals?.sent), color: "bg-chart-2" },
    { id: "delivered", name: t("tiles.delivered"), value: num(totals?.delivered), color: "bg-chart-3", ratio: ratio(totals?.delivered), target: rate(totals?.delivered) },
    { id: "bounced", name: t("tiles.bounced"), value: num(totals?.bounced), color: "bg-chart-4", ratio: ratio(totals?.bounced), target: rate(totals?.bounced) },
    { id: "complained", name: t("tiles.complained"), value: num(totals?.complained), color: "bg-chart-5", ratio: ratio(totals?.complained), target: rate(totals?.complained) },
    { id: "unsubscribed", name: t("tiles.unsubscribed"), value: num(totals?.unsubscribed), color: "bg-chart-1", ratio: ratio(totals?.unsubscribed), target: rate(totals?.unsubscribed) },
  ];
  const series = [
    { key: "sent", label: t("tiles.sent"), color: "var(--chart-1)" }, { key: "delivered", label: t("tiles.delivered"), color: "var(--chart-2)" },
    { key: "bounced", label: t("tiles.bounced"), color: "var(--chart-4)" }, { key: "unsubscribed", label: t("tiles.unsubscribed"), color: "var(--chart-5)" },
  ];
  const points = data.days.map((day) => ({ day: day.day, values: Object.fromEntries(series.map((item) => [item.key, day.counts ? day.counts[item.key as "sent"] : null])) }));
  const keys = ["selected", "skipped", "queued", "failed", "unknown", "operatorReview", "accepted", "delivered"] as const;
  const date = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", dateStyle: "medium" });

  return <div className="flex min-w-0 flex-col gap-6" data-testid="newsletter-campaign-analytics" data-state={data.campaign.state}>
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <Link href={`${base}/analytics`} className="mb-1.5 flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:underline lg:min-h-0"><ArrowLeft className="size-3.5" aria-hidden="true" />{t("back")}</Link>
        <h1 className="flex flex-wrap items-center gap-2.5 text-[28px] font-semibold tracking-tight">{data.campaign.name}
          <StatusBadge tone={tone(data.campaign.state)} label={campaignT(`status.${data.campaign.state as "sent"}`)} /></h1>
      </div>
      <Button asChild variant="outline" size="responsive"><Link href={`${base}/campaigns/${data.campaign.id}`}><MailPlus aria-hidden="true" />{t("openCampaign")}</Link></Button>
    </header>
    {!data.sent ? <EmptyState icon={MailPlus} title={t("notSent.title")} description={t("notSent.description")} solid headingLevel={2} /> : <>
      <ReportStatCards stats={stats} columns={3} />
      <ReportTrendCard id="campaign-daily" title={t("campaign.sinceSend")} caption={t("daily.caption")} dayHeader={t("daily.day")} points={points} series={series} />
      <ReportBarsCard id="status" title={t("campaign.statusTitle")} description="" caption={t("campaign.statusCaption")} keyHeader={t("campaign.statusKey")}
        rows={keys.map((key) => ({ key, label: t(`campaign.status.${key}`), values: { count: status ? status[key] : null } }))} series={[{ key: "count", label: t("campaign.count"), color: "var(--chart-1)" }]} />
    </>}
    <footer className="text-xs text-muted-foreground" data-testid="analytics-footer">
      <p>{t("campaign.footer", { start: date(data.range.from), end: date(data.generatedAt.slice(0, 10)) })}</p>
    </footer>
  </div>;
}
