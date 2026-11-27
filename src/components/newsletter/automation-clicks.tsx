"use client";
import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/data-table";
import { ReportBarsCard } from "@/components/crm/reports/report-bars-card";
import { ReportStatCards, type ReportStat } from "@/components/crm/reports/report-stat-cards";
import { ReportTrendCard } from "@/components/crm/reports/report-trend-card";
import { useCrmRequest } from "@/components/crm/request";
import type { AutomationStep } from "@/lib/newsletter-automations";

type Clicks = { counting: boolean; total: number | null; days: { day: string; clicks: number | null }[]; steps: { step: number; clicks: number | null }[]; links: { url: string; clicks: number }[] };

/**
 * Link clicks on this automation's emails, on the same report tiles, trend, bars and top-links table as campaign analytics. Totals only; a withheld
 * figure (a group under 5) reads "Fewer than 5". Owners and admins only: anyone else gets nothing back and this section stays hidden.
 */
export function AutomationClicks({ tenantId, automationId, steps }: { tenantId: string; automationId: string; steps: AutomationStep[] }) {
  const t = useTranslations("NewsletterAnalytics"), c = useTranslations("NewsletterAutomations.clicks"), format = useFormatter(), request = useCrmRequest();
  const [data, setData] = useState<Clicks | null>(null);
  useEffect(() => {
    let live = true;
    void request<Clicks>(`/api/workspaces/${tenantId}/newsletter/automations/${automationId}/clicks`, { method: "GET" }).then((result) => { if (live && result.ok) setData(result.data); });
    return () => { live = false; };
  }, [request, tenantId, automationId]);
  if (!data) return null;
  const counted = data.counting || data.total !== 0 || data.steps.length > 0;
  const stats: ReportStat[] = [{ id: "clicks", name: t("tiles.clicks"), value: !counted ? t("clicksOff") : data.total === null ? null : format.number(data.total), target: t("clicksNote"), color: "bg-chart-3" }];
  const stepLabel = (index: number) => {
    const step = steps[index];
    return step?.type === "email" && step.subject ? c("stepNamed", { number: index + 1, subject: step.subject }) : c("step", { number: index + 1 });
  };
  const series = [{ key: "clicks", label: t("tiles.clicks"), color: "var(--chart-3)" }];
  return <section className="flex min-w-0 flex-col gap-4" aria-label={c("title")} data-automation-clicks>
    <h2 className="text-lg font-semibold">{c("title")}</h2>
    <ReportStatCards stats={stats} columns={4} />
    {counted && <>
      <ReportTrendCard id="automation-clicks-daily" title={c("daily")} description="" caption={c("dailyCaption")} dayHeader={t("daily.day")}
        points={data.days.map((day) => ({ day: day.day, values: { clicks: day.clicks } }))} series={series} />
      <ReportBarsCard id="automation-clicks-steps" title={c("byStep")} description="" caption={c("byStepCaption")} keyHeader={c("stepHeader")}
        rows={data.steps.map((step) => ({ key: String(step.step), label: stepLabel(step.step), values: { clicks: step.clicks } }))} series={series} />
      <Card data-testid="automation-top-links">
        <CardHeader><CardTitle>{t("topLinks.title")}</CardTitle></CardHeader>
        <CardContent>
          <DataTable bordered={false} label={t("topLinks.title")} empty={<p className="text-sm text-muted-foreground">{t("topLinks.empty")}</p>}
            columns={[{ id: "link", header: t("topLinks.link"), card: "title" }, { id: "clicks", header: t("topLinks.clicks"), align: "end", className: "w-24" }]}
            rows={data.links.map((link) => ({ id: link.url, label: link.url, cells: {
              link: <span className="flex min-h-11 min-w-0 items-center break-all text-sm" data-top-link>{link.url}</span>,
              clicks: <span className="tabular-nums">{format.number(link.clicks)}</span> } }))} />
        </CardContent>
      </Card>
    </>}
    <p className="text-xs text-muted-foreground">{c("footer", { clicks: t(data.counting ? "clicksFooter.on" : "clicksFooter.off") })}</p>
  </section>;
}
