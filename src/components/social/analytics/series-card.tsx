/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/sales/components/revenue-chart.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { enter } from "@/components/social/analytics/entrance";
import { hasAnyValue, type SeriesMetric, type SeriesPoint } from "@/lib/social/analytics-view";

const chartConfig = { value: { label: "", color: "var(--chart-1)" } } satisfies ChartConfig;

/** The selected metric over the range. Days without a reading are gaps in the line and "Unavailable" in the table, never zeros. */
export function SeriesCard<M extends string = SeriesMetric>({ metrics, metric, onMetric, labelOf, points, animate, index, timezone, loading, format: formatValue }: {
  metrics: readonly M[]; metric: M; onMetric: (metric: M) => void; labelOf: (metric: M) => string;
  points: readonly SeriesPoint[]; animate: boolean; index: number; timezone: string; loading: boolean;
  /** How the table and tooltip show a value (for example a currency); a plain number when omitted. */
  format?: (value: number) => string;
}) {
  const t = useTranslations("SocialAnalytics.series"), format = useFormatter();
  const entry = enter(animate, index);
  const day = (value: string, style: "short" | "long") => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric", ...(style === "long" ? { year: "numeric" } : {}) });
  const drawn = hasAnyValue(points);
  const data = points.map((point) => ({ day: point.day, value: point.value }));
  return (
    <Card className={entry.className} style={entry.style} data-testid="series-card" aria-busy={loading || undefined}>
      <CardHeader className="@max-md/card:grid!">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("subtitle", { metric: labelOf(metric), zone: timezone })}</CardDescription>
        <CardAction className="max-md:col-span-full max-md:row-start-3 max-md:mt-3 max-md:justify-self-start">
          <ToggleGroup type="single" variant="outline" value={metric} onValueChange={(value) => { if (value) onMetric(value as M); }} aria-label={t("metric")} className="flex-wrap">
            {metrics.map((item) => <ToggleGroupItem key={item} value={item} data-testid={`series-${item}`}>{labelOf(item)}</ToggleGroupItem>)}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {drawn ? (
          <ChartContainer config={chartConfig} className="h-64 w-full" data-testid="series-chart">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="series-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={(value: string) => day(value, "short")} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value: number) => format.number(value, { notation: "compact" })} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" labelFormatter={(value) => day(String(value), "long")} />} />
              <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="url(#series-fill)" connectNulls={false}
                dot={data.length <= 3} isAnimationActive={animate} animationDuration={300} />
            </AreaChart>
          </ChartContainer>
        ) : (
          <div className="flex h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground" data-testid="series-unavailable">{t("unavailable")}</div>
        )}
        <table className="sr-only">
          <caption>{t("tableCaption", { metric: labelOf(metric) })}</caption>
          <thead><tr><th scope="col">{t("day")}</th><th scope="col">{labelOf(metric)}</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.day}><th scope="row">{day(point.day, "long")}</th><td>{point.value === null ? t("unavailableValue") : formatValue ? formatValue(point.value) : format.number(point.value)}</td></tr>)}</tbody>
        </table>
      </CardContent>
    </Card>
  );
}
