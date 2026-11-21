"use client";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { enter } from "@/components/social/analytics/entrance";
import { bestSlot, heatLevel, maxHeat, type HeatCell } from "@/lib/social/analytics-view";
import { cn } from "@/lib/utils";

const dayIndexes = [0, 1, 2, 3, 4, 5, 6] as const;
const hours = Array.from({ length: 24 }, (_, hour) => hour);

function Cell({ cell, max, label }: { cell: HeatCell | undefined; max: number; label: string }) {
  const level = heatLevel(cell?.averageEngagement ?? null, max);
  return <td className="p-0.5" data-level={level.toFixed(2)} data-has-data={level > 0 || undefined}>
    <div title={label} className={cn("h-5 min-w-5 rounded-[4px] sm:h-6", level === 0 && "border border-dashed border-border bg-muted/30")}
      style={level > 0 ? { backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(level * 100)}%, transparent)` } : undefined}>
      <span className="sr-only">{label}</span></div>
  </td>;
}

/** Day by hour grid as a real table. Wide screens put hours across; phones put days across (seven columns fit at 360) and hours down. */
function Grid({ cells, orientation, dayName, hourName, describe, caption }: {
  cells: readonly HeatCell[]; orientation: "wide" | "narrow"; dayName: (day: number) => string; hourName: (hour: number) => string; describe: (cell: HeatCell | undefined, day: number, hour: number) => string; caption: string;
}) {
  const max = maxHeat(cells), at = (day: number, hour: number) => cells.find((cell) => cell.day === day && cell.hour === hour);
  const narrow = orientation === "narrow";
  return (
    <table className={cn("w-full border-separate border-spacing-0 text-xs", narrow ? "sm:hidden" : "hidden sm:table")} data-testid={narrow ? "heatmap-narrow" : "heatmap-wide"}>
      <caption className="sr-only">{caption}</caption>
      <thead><tr><td />{(narrow ? dayIndexes.map((day) => ({ key: day, text: dayName(day) })) : hours.map((hour) => ({ key: hour, text: hour % 3 === 0 ? hourName(hour) : "" })))
        .map((head) => <th key={head.key} scope="col" className="px-0.5 pb-1 text-center font-normal text-muted-foreground"><span className={head.text ? undefined : "sr-only"}>{head.text || (narrow ? dayName(head.key) : hourName(head.key))}</span></th>)}</tr></thead>
      <tbody>{narrow
        ? hours.map((hour) => <tr key={hour}><th scope="row" className="pr-2 text-right font-normal text-muted-foreground"><span className={hour % 3 === 0 ? undefined : "sr-only"}>{hourName(hour)}</span></th>
            {dayIndexes.map((day) => <Cell key={day} cell={at(day, hour)} max={max} label={describe(at(day, hour), day, hour)} />)}</tr>)
        : dayIndexes.map((day) => <tr key={day}><th scope="row" className="pr-2 text-right font-normal text-muted-foreground">{dayName(day)}</th>
            {hours.map((hour) => <Cell key={hour} cell={at(day, hour)} max={max} label={describe(at(day, hour), day, hour)} />)}</tr>)}</tbody>
    </table>
  );
}

/** Best times to post: when the posts in the range earned the most engagement (in the chosen time zone), or the provider's audience times (UTC). */
export function HeatmapCard({ observed, provider, timezone, providerTimezone, animate, index }: {
  observed: readonly HeatCell[]; provider: readonly HeatCell[]; timezone: string; providerTimezone: string; animate: boolean; index: number;
}) {
  const t = useTranslations("SocialAnalytics.heatmap"), days = useTranslations("SocialAnalytics.days"), format = useFormatter(), entry = enter(animate, index);
  const [source, setSource] = useState<"observed" | "provider">("observed");
  const cells = source === "observed" ? observed : provider, zone = source === "observed" ? timezone : providerTimezone;
  const best = bestSlot(cells);
  const dayName = (day: number) => days(String(day) as "0");
  const hourName = (hour: number) => format.number(hour, { minimumIntegerDigits: 2 }) + ":00";
  const describe = (cell: HeatCell | undefined, day: number, hour: number) => cell && cell.averageEngagement !== null
    ? t("cell", { day: dayName(day), hour: hourName(hour), value: format.number(cell.averageEngagement, { maximumFractionDigits: 1 }), samples: cell.samples })
    : t("cellEmpty", { day: dayName(day), hour: hourName(hour) });
  return (
    <Card className={entry.className} style={entry.style} data-testid="heatmap-card">
      <CardHeader className="@max-md/card:grid!">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("zone", { zone })}</CardDescription>
        <CardAction className="max-md:col-span-full max-md:row-start-3 max-md:mt-3 max-md:justify-self-start">
          <ToggleGroup type="single" variant="outline" value={source} onValueChange={(value) => { if (value) setSource(value as "observed" | "provider"); }} aria-label={t("source")}>
            <ToggleGroupItem value="observed" data-testid="heatmap-observed">{t("observed")}</ToggleGroupItem>
            <ToggleGroupItem value="provider" data-testid="heatmap-provider">{t("provider")}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {best ? <>
          <p className="text-sm" data-testid="heatmap-best">{t("best", { day: dayName(best.day), hour: hourName(best.hour), value: format.number(best.averageEngagement!, { maximumFractionDigits: 1 }), samples: best.samples })}</p>
          <Grid cells={cells} orientation="wide" dayName={dayName} hourName={hourName} describe={describe} caption={t("caption", { zone })} />
          <Grid cells={cells} orientation="narrow" dayName={(day) => dayName(day).slice(0, 3)} hourName={hourName} describe={describe} caption={t("caption", { zone })} />
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span>{t("less")}</span>
            <span className="flex gap-0.5">{[0.15, 0.4, 0.65, 0.9].map((level) => <span key={level} className="size-4 rounded-[4px]" style={{ backgroundColor: `color-mix(in oklab, var(--chart-1) ${level * 100}%, transparent)` }} />)}</span>
            <span>{t("more")}</span>
            <span className="ms-2 flex items-center gap-1.5"><span className="size-4 rounded-[4px] border border-dashed border-border bg-muted/30" />{t("noData")}</span>
          </div>
        </> : <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="heatmap-empty">{t("empty")}</p>}
      </CardContent>
    </Card>
  );
}
