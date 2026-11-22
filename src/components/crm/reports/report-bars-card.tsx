/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/ai-analytics/components/usage-by-model-card.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Bar, BarChart, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ReportBar = { key: string; label: string; /** One figure per series; null is withheld (fewer than 5). */ values: Record<string, number | null> };
export type ReportSeries = { key: string; label: string; color: string };

/**
 * A titled card with a horizontal bar chart and the same figures as a table. Withheld figures are never drawn (no zero-length bar): the table
 * reads "Fewer than 5" for them. The chart is hidden from assistive technology because the table carries every number.
 */
export function ReportBarsCard({ id, title, description, caption, keyHeader, rows, series }: {
  id: string; title: string; description: string; caption: string; keyHeader: string; rows: readonly ReportBar[]; series: readonly ReportSeries[];
}) {
  const t = useTranslations("CrmReports"), format = useFormatter();
  const config = Object.fromEntries(series.map((item) => [item.key, { label: item.label, color: item.color }])) satisfies ChartConfig;
  const data = rows.map((row) => ({ name: row.label, ...Object.fromEntries(series.map((item) => [item.key, row.values[item.key] ?? undefined])) }));
  const drawn = rows.some((row) => series.some((item) => (row.values[item.key] ?? 0) > 0));
  return (
    <Card className="h-full" data-testid={`report-card-${id}`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {drawn && (
          <div aria-hidden="true" data-testid={`report-chart-${id}`}>
            <ChartContainer config={config} className="aspect-auto w-full" style={{ height: 28 + rows.length * (series.length > 1 ? 44 : 32) }}>
              <BarChart layout="vertical" data={data} margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2}>
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={96} tickMargin={4} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                {series.map((item) => <Bar key={item.key} dataKey={item.key} fill={`var(--color-${item.key})`} radius={4} barSize={series.length > 1 ? 12 : 18} isAnimationActive={false} />)}
              </BarChart>
            </ChartContainer>
          </div>
        )}
        <Table data-testid={`report-table-${id}`}>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{keyHeader}</TableHead>
              {series.map((item) => <TableHead key={item.key} scope="col" className="text-right">{item.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableHead scope="row" className="font-medium">{row.label}</TableHead>
                {series.map((item) => {
                  const value = row.values[item.key];
                  return <TableCell key={item.key} className={value === null || value === undefined ? "text-muted-foreground text-right" : "text-right tabular-nums"} data-testid={value === null || value === undefined ? "report-hidden" : "report-value"}>
                    {value === null || value === undefined ? t("hidden") : format.number(value)}
                  </TableCell>;
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
