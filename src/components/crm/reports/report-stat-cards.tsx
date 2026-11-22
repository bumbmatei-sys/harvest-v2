/** Derived from bumbmatei-sys/admin-dashboard (Shadcn UI Kit, premium, founder-supplied): app/dashboard/(auth)/ai-analytics/components/stat-cards.tsx. Harvest changes: docs/ui-sources.md. */
"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ReportStat = {
  name: string;
  description: string;
  /** Formatted figure, or null when the server withheld it (fewer than 5). */
  value: string | null;
  target?: string;
  /** 0 to 1 draws a bar; null draws an empty track; omitted draws no bar. */
  ratio?: number | null;
  color: string;
  id: string;
};

const SEGMENT_COUNT = 32;

function TickProgress({ ratio, color, label }: { ratio: number | null; color: string; label: string }) {
  const filled = ratio === null ? 0 : Math.round(ratio * SEGMENT_COUNT);
  const track = (
    <>
      {Array.from({ length: SEGMENT_COUNT }).map((_, index) => (
        <span key={index} className="bg-muted-foreground/20 relative h-5 w-1 flex-1 rounded-full">
          {index < filled && <span className={cn(color, "absolute inset-0 rounded-full")} />}
        </span>
      ))}
    </>
  );
  if (ratio === null) return <div aria-hidden="true" className="flex items-center gap-1">{track}</div>;
  return (
    <div role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label} className="flex items-center gap-1">
      {track}
    </div>
  );
}

/** The summary row of the reports screen. A withheld figure reads "Fewer than 5" and draws no bar; it is never shown as zero. */
export function ReportStatCards({ stats, columns = 4 }: { stats: readonly ReportStat[]; columns?: 3 | 4 }) {
  const t = useTranslations("CrmReports");
  return (
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6", columns === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4")} data-testid="report-stats">
      {stats.map((item) => (
        <Card key={item.id} data-testid="report-stat" data-metric={item.id}>
          <CardHeader>
            <CardTitle>{item.name}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-end gap-3">
            <div className="flex flex-wrap items-baseline gap-1.5">
              {item.value === null
                ? <span className="text-muted-foreground text-lg font-semibold" data-testid="report-hidden">{t("hidden")}</span>
                : <span className="text-2xl font-semibold tabular-nums lg:text-3xl" data-testid="report-value">{item.value}</span>}
              {item.value !== null && item.target && <span className="text-muted-foreground text-sm">{item.target}</span>}
            </div>
            {item.ratio !== undefined && <TickProgress ratio={item.value === null ? null : item.ratio} color={item.color} label={item.name} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
