/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/finance/components/kpi-cards.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { cn } from "@/lib/utils";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingDownIcon, TrendingUpIcon, MinusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Bar, BarChart } from "recharts";
import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { StatusBadge } from "@/components/status-badge";
import { AnimatedNumber } from "@/components/social/analytics/animated-number";
import { enter } from "@/components/social/analytics/entrance";
import { type Delta, type Reading, type SeriesPoint } from "@/lib/social/analytics-view";

const chartConfig = { value: { label: "", color: "var(--chart-1)" } } satisfies ChartConfig;

/** One headline number with its change against the previous period and a trend sparkline. A missing reading says "Unavailable"; it is never drawn as zero. */
export function StatCard({ label, reading, delta, points, animate, index, signed = false, format, periodLabel, attention = false }: {
  /** A figure that needs attention: red text on a faintly red card. */
  attention?: boolean; label: string; reading: Reading; delta: Delta | null; points: readonly SeriesPoint[]; animate: boolean; index: number; signed?: boolean;
  format: (value: number) => string; periodLabel: string;
}) {
  const t = useTranslations("SocialAnalytics.cards");
  const value = reading.value, entry = enter(animate, index);
  const shown = (amount: number) => signed && amount > 0 ? `+${format(amount)}` : format(amount);
  const trend = points.map((point) => ({ day: point.day, value: point.value }));
  const drawn = trend.some((point) => point.value !== null);
  const percent = delta?.percent === null || delta === null ? null : `${delta.percent > 0 ? "+" : ""}${Math.round(delta.percent)}%`;
  const change = delta ? (percent ?? `${delta.difference > 0 ? "+" : ""}${format(delta.difference)}`) : null;
  return (
    <Card className={cn(entry.className, attention && "border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10")} style={entry.style} data-testid="stat-card" data-metric={label}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
        {delta && change && (
          <CardAction>
            <StatusBadge tone={delta.direction === "up" ? "success" : delta.direction === "down" ? "danger" : "neutral"} label={change}
              className="h-6 gap-1 text-xs" />
            <span className="sr-only">{t(delta.direction === "up" ? "increased" : delta.direction === "down" ? "decreased" : "unchanged", { period: periodLabel })}</span>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-1 pb-0">
        {value === null
          ? <div className="text-2xl font-semibold text-muted-foreground lg:text-3xl" data-testid="stat-unavailable">{t("unavailable")}</div>
          : <div className="text-2xl font-semibold tabular-nums lg:text-3xl" data-testid="stat-value">
              {animate ? <AnimatedNumber value={value} animate format={shown} /> : shown(value)}
            </div>}
        <p className="flex min-h-5 items-center gap-1.5 text-xs text-muted-foreground">
          {delta ? <>{delta.direction === "up" ? <TrendingUpIcon className="size-3.5" aria-hidden="true" /> : delta.direction === "down" ? <TrendingDownIcon className="size-3.5" aria-hidden="true" /> : <MinusIcon className="size-3.5" aria-hidden="true" />}{t("versus", { period: periodLabel })}</> : t("noComparison")}
          {reading.availability === "partial" && <StatusBadge tone="warning" label={t("partial")} />}
        </p>
        {drawn ? (
          <div aria-hidden="true" className="mt-auto pt-3">
            <ChartContainer config={chartConfig} className="h-12 w-full">
              <BarChart accessibilityLayer={false} data={trend} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel hideIndicator />} />
                <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} isAnimationActive={animate} animationDuration={300} />
              </BarChart>
            </ChartContainer>
          </div>
        ) : <div className="h-12 pt-3" aria-hidden="true" />}
      </CardContent>
    </Card>
  );
}
