"use client";

import { useEffect, useRef, useState } from "react";
import { ChartColumn, RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { ReportBarsCard } from "@/components/crm/reports/report-bars-card";
import { ReportPeriodTabs } from "@/components/crm/reports/report-period-tabs";
import { ReportStatCards, type ReportStat } from "@/components/crm/reports/report-stat-cards";
import { reportSources, type ReportPeriod } from "@/lib/crm-reports";
import type { CrmReport } from "@/server/crm-reports";

type State = { report: CrmReport; loading: boolean; failed: boolean };

/**
 * CRM reports: read-only aggregates. Every figure comes from the reports route; a figure the server withheld (fewer than 5) arrives as null and is
 * shown as "Fewer than 5", never as zero. The period changes with one request; nothing else is sent.
 */
export function ReportsView({ tenantId, initial }: { tenantId: string; initial: CrmReport }) {
  const t = useTranslations("CrmReports"), format = useFormatter();
  const [period, setPeriod] = useState<ReportPeriod>(initial.period), [state, setState] = useState<State>({ report: initial, loading: false, failed: false });
  const [attempt, setAttempt] = useState(0), first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; if (period === initial.period) return; }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true, failed: false }));
    fetch(`/api/workspaces/${tenantId}/crm/reports?period=${period}`, { cache: "no-store", signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<CrmReport>; })
      .then((report) => setState({ report, loading: false, failed: false }))
      .catch((error: unknown) => { if ((error as { name?: string })?.name !== "AbortError") setState((previous) => ({ ...previous, loading: false, failed: true })); });
    return () => controller.abort();
  }, [period, attempt, tenantId, initial.period]);

  const { report } = state, { deals, tasks, contacts } = report;
  const num = (value: number | null) => value === null ? null : format.number(value);
  const dateTime = (value: string, options: { dateStyle?: "medium"; timeStyle?: "short" }) => format.dateTime(new Date(value), { timeZone: "UTC", ...options });
  const conversion = deals.created === 0 ? "–" : deals.conversionPercent === null ? null : `${format.number(deals.conversionPercent, { maximumFractionDigits: 1 })}%`;
  const stats: ReportStat[] = [
    { id: "deals", name: t("cards.dealsCreated"), description: t("cards.dealsCreatedHelp"), value: num(deals.created), color: "bg-chart-1" },
    { id: "conversion", name: t("cards.conversion"), description: t("cards.conversionHelp"), value: conversion, color: "bg-chart-2", ratio: deals.conversionPercent === null ? 0 : deals.conversionPercent / 100,
      target: deals.won !== null && deals.created !== null ? t("cards.conversionOf", { won: format.number(deals.won), created: format.number(deals.created) }) : undefined },
    { id: "completed", name: t("cards.tasksCompleted"), description: t("cards.tasksCompletedHelp"), value: num(tasks.completed), color: "bg-chart-3" },
    { id: "overdue", name: t("cards.overdue"), description: t("cards.overdueHelp"), value: num(tasks.overdue), color: "bg-chart-4", ratio: tasks.overdue !== null && tasks.open ? tasks.overdue / tasks.open : 0,
      target: tasks.open !== null ? t("cards.overdueOf", { open: format.number(tasks.open) }) : undefined },
    ...(contacts ? [
      { id: "contacts", name: t("cards.contactsAdded"), description: t("cards.contactsAddedHelp"), value: num(contacts.added), color: "bg-chart-5" },
      { id: "withDeal", name: t("cards.contactsWithDeal"), description: t("cards.contactsWithDealHelp"), value: num(contacts.withDeal), color: "bg-chart-1", ratio: contacts.withDeal !== null && contacts.added ? contacts.withDeal / contacts.added : 0,
        target: contacts.added !== null ? t("cards.withDealOf", { count: format.number(contacts.added) }) : undefined },
    ] satisfies ReportStat[] : []),
  ];
  const quiet = deals.created === 0 && tasks.completed === 0 && tasks.open === 0 && (!contacts || contacts.added === 0);
  const sources = contacts ? reportSources.map((source) => contacts.sources.find((row) => row.source === source)!) : [];

  return <div className="flex flex-col gap-6" data-testid="reports-page" data-period={report.period} data-scope={report.scope} data-ready={state.loading ? undefined : "true"} aria-busy={state.loading || undefined}>
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground"><ChartColumn className="size-3.5" aria-hidden="true" />{t("crm")}</div>
        <h1 className="flex flex-wrap items-center gap-2.5 text-[28px] font-semibold tracking-tight">{t("title")}
          <Badge variant="secondary" className="rounded-md" data-testid="report-scope">{t(report.scope === "ministry" ? "scopeMinistry" : "scopeOwn")}</Badge></h1>
      </div>
      <ReportPeriodTabs value={period} onValueChange={setPeriod} />
    </header>
    {state.failed && <Alert variant="destructive" data-testid="reports-error"><AlertDescription className="flex flex-wrap items-center gap-3">{t("error.message")}
      <Button type="button" variant="outline" size="responsive" onClick={() => setAttempt((count) => count + 1)}><RotateCw aria-hidden="true" />{t("error.retry")}</Button></AlertDescription></Alert>}
    <div className={state.loading ? "flex flex-col gap-6 opacity-60 transition-opacity" : "flex flex-col gap-6"}>
      <ReportStatCards stats={stats} columns={contacts ? 3 : 4} />
      {quiet ? <EmptyState icon={ChartColumn} title={t("empty.title")} description={t("empty.description")} solid headingLevel={2} /> : <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 lg:gap-6">
        <ReportBarsCard id="deals" title={t("deals.title")} description={t("deals.description")} caption={t("chart.deals")} keyHeader={t("deals.outcome")}
          rows={(["won", "open", "lost"] as const).map((key) => ({ key, label: t(`deals.${key}`), values: { count: deals[key] } }))} series={[{ key: "count", label: t("deals.count"), color: "var(--chart-1)" }]} />
        <ReportBarsCard id="tasks" title={t("tasks.title")} description={t("tasks.description")} caption={t("chart.tasks")} keyHeader={t("tasks.status")}
          rows={[{ key: "overdue", label: t("tasks.overdue"), values: { count: tasks.overdue } }, { key: "onTime", label: t("tasks.onTime"), values: { count: tasks.onTime } }]} series={[{ key: "count", label: t("tasks.count"), color: "var(--chart-4)" }]} />
        {contacts && <div className="xl:col-span-2"><ReportBarsCard id="sources" title={t("sources.title")} description={t("sources.description")} caption={t("chart.sources")} keyHeader={t("sources.source")}
          rows={sources.map((row) => ({ key: row.source, label: t(`sources.${row.source}`), values: { added: row.added, withDeal: row.withDeal } }))}
          series={[{ key: "added", label: t("sources.added"), color: "var(--chart-1)" }, { key: "withDeal", label: t("sources.withDeal"), color: "var(--chart-2)" }]} /></div>}
      </div>}
    </div>
    <footer className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="report-footer">
      <p>{t("footer.line", { start: dateTime(report.window.start, { dateStyle: "medium" }), end: dateTime(report.window.end, { dateStyle: "medium" }), time: dateTime(report.generatedAt, { timeStyle: "short" }) })}</p>
      <p>{t("footer.small")} {t("footer.cases")}{contacts && ` ${t("footer.sources")}`}</p>
    </footer>
  </div>;
}
