"use client";
import { useFormatter, useTranslations } from "next-intl";
import { StatCard } from "@/components/social/analytics/stat-card";
import { daily, daysBetween, totalsFor, type ResultsRow } from "@/lib/ads/view";
import type { ResultMetric } from "@/lib/ads/ads";

/** Spend, results, cost per result and reach for the campaigns shown, over the range. Reuses the shared StatCard; a measure nobody reported reads Unavailable, never zero. */
export function AdsSummary({ results, ids, range, currency }: { results: readonly ResultsRow[]; ids: ReadonlySet<string>; range: { from: string; to: string }; currency: string }) {
  const t = useTranslations("Ads.summary"), format = useFormatter();
  const totals = totalsFor(results, ids), days = daysBetween(range.from, range.to);
  const money = (v: number) => format.number(v, { style: "currency", currency, maximumFractionDigits: v >= 100 ? 0 : 2 }), count = (v: number) => format.number(Math.round(v));
  const card = (metric: ResultMetric, label: string, fmt: (v: number) => string) => {
    const value = totals[metric];
    return <StatCard key={metric} label={label} reading={value === undefined ? { value: null, availability: "unavailable" } : { value, availability: "available" }} delta={null}
      points={daily(results, ids, metric, days)} animate={false} index={0} format={fmt} periodLabel={t("period")} />;
  };
  return <section aria-label={t("group")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6" data-ads-summary>
    {card("spend", t("spend"), money)}{card("results", t("results"), count)}{card("costPerResult", t("costPerResult"), money)}{card("reach", t("reach"), count)}
  </section>;
}
