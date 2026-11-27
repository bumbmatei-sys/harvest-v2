/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/hotel/components/campaign-overview.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import type { ReactNode } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type TrendSeries = { key: string; label: string; color: string };
/**
 * One UTC day. A null value is a withheld day (fewer than 5): a gap in the line and "Fewer than 5" in the table, never a zero. A point marked
 * `noData` (nothing was recorded that day, e.g. before daily counts began) is a gap too and reads `noDataLabel` in the table.
 */
export type TrendPoint = { day: string; values: Record<string, number | null>; noData?: boolean };

/**
 * A titled card with a multi-line chart over days and the same figures as a table. The chart is hidden from assistive technology because the
 * table carries every number. Shares the card, chart container and tooltip with the other report cards.
 */
export function ReportTrendCard({ id, title, description, caption, dayHeader, points, series, noDataLabel, children }: {
  id: string; title: string; description?: string; caption: string; dayHeader: string; points: readonly TrendPoint[]; series: readonly TrendSeries[];
  noDataLabel?: string; children?: ReactNode;
}) {
  const t = useTranslations("CrmReports"), format = useFormatter();
  const config = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;
  const day = (value: string, long = false) => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric", ...(long ? { year: "numeric" } : {}) });
  const data = points.map((point) => ({ day: point.day, ...Object.fromEntries(series.map((item) => [item.key, point.noData ? undefined : point.values[item.key] ?? undefined])) }));
  const cell = (point: TrendPoint, key: string) => point.noData ? noDataLabel ?? t("hidden")
    : point.values[key] === null || point.values[key] === undefined ? t("hidden") : format.number(point.values[key]!);
  return (
    <Card data-testid={`report-card-${id}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {children}
        <div aria-hidden="true" data-testid={`report-chart-${id}`}>
          <ChartContainer config={config} className="aspect-auto h-64 w-full">
            <LineChart accessibilityLayer={false} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(value: string) => day(value)} />
              <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} tickFormatter={(value: number) => format.number(value, { notation: "compact" })} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" labelFormatter={(value) => day(String(value), true)} />} />
              <ChartLegend content={<ChartLegendContent />} />
              {series.map((item) => <Line key={item.key} dataKey={item.key} type="monotone" stroke={`var(--color-${item.key})`} strokeWidth={2} dot={data.length <= 7} connectNulls={false} isAnimationActive={false} />)}
            </LineChart>
          </ChartContainer>
        </div>
        <table className="sr-only" data-testid={`report-table-${id}`}>
          <caption>{caption}</caption>
          <thead><tr><th scope="col">{dayHeader}</th>{series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
          <tbody>{points.map((point) => <tr key={point.day}><th scope="row">{day(point.day, true)}</th>
            {series.map((item) => <td key={item.key}>{cell(point, item.key)}</td>)}</tr>)}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}
