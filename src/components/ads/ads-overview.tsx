/** Layout modelled on the dashboard blocks already approved for Social Analytics and the CRM reports (shared StatCard, SeriesCard, Card, StatusBadge, EmptyState); code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ListChecks, Megaphone, RotateCw, Table2, Target } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { RangePicker } from "@/components/social/analytics/range-picker";
import { SeriesCard } from "@/components/social/analytics/series-card";
import { StatCard } from "@/components/social/analytics/stat-card";
import { useEntrance } from "@/components/social/analytics/entrance";
import { AdsAttention } from "@/components/ads/ads-attention";
import { AdsAccountHealth } from "@/components/ads/ads-account-health";
import { useAdsError } from "@/components/ads/ads-error";
import { useAdsOverview } from "@/components/ads/use-ads-overview";
import { activeCampaigns, attentionItems } from "@/lib/ads/overview";
import { daily, daysBetween, totalsFor } from "@/lib/ads/view";
import type { ResultMetric } from "@/lib/ads/ads";
import { deltaOf, presetRange, todayIn, type Reading } from "@/lib/social/analytics-view";
import { browserTimeZone } from "@/lib/social/time";
import { notify } from "@/lib/toast";

const seriesMetrics = ["spend", "results", "costPerResult", "clicks", "impressions"] as const;
type SeriesId = typeof seriesMetrics[number];
const money = new Set<ResultMetric>(["spend", "costPerResult", "cpc", "cpm"]);

/**
 * Social media > Ads > Overview. Spend, results, cost per result and active campaigns for one ad account over a range, a chart of one measure per day, what needs attention
 * and the health of every connected ad account. Only stored results are shown: a measure nobody reported reads Unavailable, never zero.
 */
export function AdsOverview({ tenantId }: { tenantId: string }) {
  const t = useTranslations("Ads.overview"), l = useTranslations("Ads"), s = useTranslations("Ads.summary"), explain = useAdsError(), format = useFormatter();
  const [timezone] = useState(() => browserTimeZone()), [today] = useState(() => todayIn(timezone));
  const [range, setRange] = useState(() => presetRange(28, today));
  const [metric, setMetric] = useState<SeriesId>("spend"), [notice, setNotice] = useState(""), [checking, setChecking] = useState<string | null>(null);
  const data = useAdsOverview(tenantId, range, timezone);
  const entrance = useEntrance(data.status === "ready");
  const currency = data.account?.currency ?? "USD", busy = data.status === "loading" || data.reloading;
  const ids = useMemo(() => new Set(data.tree.map((c) => c.id)), [data.tree]);
  const days = useMemo(() => daysBetween(range.from, range.to), [range.from, range.to]);
  const now = useMemo(() => totalsFor(data.current, ids), [data.current, ids]), before = useMemo(() => totalsFor(data.previous, ids), [data.previous, ids]);
  const items = useMemo(() => data.account ? attentionItems({ account: data.account, alerts: data.alerts, campaigns: data.tree, spent: data.spent, flags: data.flags }) : [], [data.account, data.alerts, data.tree, data.spent, data.flags]);

  const asMoney = (v: number) => format.number(v, { style: "currency", currency, maximumFractionDigits: v >= 100 ? 0 : 2 }), asCount = (v: number) => format.number(Math.round(v));
  const fmt = (m: ResultMetric) => money.has(m) ? asMoney : m === "ctr" ? (v: number) => format.number(v, { style: "percent", maximumFractionDigits: 2 }) : asCount;
  const reading = (m: ResultMetric, from: typeof now): Reading => from[m] === undefined ? { value: null, availability: "unavailable" } : { value: from[m]!, availability: "available" };
  const card = (m: ResultMetric, label: string, index: number, upIsGood = true) => <StatCard key={m} label={label} reading={reading(m, now)} delta={deltaOf(reading(m, now), reading(m, before))} upIsGood={upIsGood}
    points={daily(data.current, ids, m, days)} animate={entrance.animate} index={index} format={fmt(m)} periodLabel={s("period")} />;

  const checkHealth = async (id: string) => {
    setChecking(id); setNotice("");
    try { await data.checkHealth(id); notify.success(t("health.checked")); } catch (error) { setNotice(explain(error)); } finally { setChecking(null); }
  };

  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{l("subtitle", { zone: data.account?.timezone ?? timezone })}</p></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      {data.accounts.length > 0 && <NativeSelect value={data.account?.id ?? ""} onChange={(event) => data.selectAccount(event.target.value)} className="min-h-11 w-auto min-w-44 max-sm:w-full lg:min-h-9" aria-label={l("account.label")} data-ads-account>
        {data.accounts.map((account) => <NativeSelectOption key={account.id} value={account.id}>{l("account.option", { name: account.name, network: l.has(`networks.${account.network}`) ? l(`networks.${account.network}`) : l("networks.other") })}</NativeSelectOption>)}</NativeSelect>}
      {data.account && <RangePicker range={range} today={today} onChange={setRange} />}
      <Button asChild variant="outline" size="responsive"><Link href={`/workspaces/${tenantId}/social/ads/rules`}><ListChecks aria-hidden="true" />{t("rulesLink")}</Link></Button>
      <Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/ads`}><Table2 aria-hidden="true" />{t("manageLink")}</Link></Button>
    </div>
  </header>;

  let body: React.ReactNode;
  if (data.status === "loading") body = <div className="flex flex-col gap-4 lg:gap-6" data-testid="ads-overview-loading">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6">{[0, 1, 2, 3].map((item) => <Card key={item}><CardHeader><Skeleton className="h-5 w-28" /></CardHeader><CardContent><Skeleton className="h-9 w-24" /></CardContent></Card>)}</div>
    <Skeleton className="h-72 w-full" /></div>;
  else if (data.status === "unavailable") body = <EmptyState icon={Target} title={l("states.unavailableTitle")} description={l("states.unavailable")} solid />;
  else if (data.status === "error") body = <Alert variant="destructive" role="alert"><AlertDescription className="flex flex-wrap items-center gap-3">{l("states.error")}
    <Button type="button" variant="outline" size="responsive" onClick={data.reload}><RotateCw aria-hidden="true" />{l("states.retry")}</Button></AlertDescription></Alert>;
  else if (!data.account) body = <EmptyState icon={Megaphone} title={l("empty.noAccountsTitle")} description={l("empty.noAccounts")} solid
    action={<Button asChild size="responsive"><Link href={`/workspaces/${tenantId}/social/ads`}>{l("empty.find")}</Link></Button>} />;
  else body = <div className="flex flex-col gap-4 lg:gap-6" data-testid="ads-overview-content" data-ads-ready={busy ? undefined : "true"}>
    {data.truncated && <Alert role="status"><AlertDescription>{l("states.truncated")}</AlertDescription></Alert>}
    <section aria-label={s("group")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6" data-ads-overview-cards>
      {card("spend", s("spend"), 0)}{card("results", s("results"), 1)}{card("costPerResult", s("costPerResult"), 2, false)}
      <StatCard label={t("activeCampaigns")} reading={{ value: activeCampaigns(data.tree, data.accountToday), availability: "available" }} delta={null} points={[]} animate={entrance.animate} index={3} format={asCount} periodLabel={s("period")} />
    </section>
    <div className="grid grid-cols-1 gap-4 lg:gap-6 xl:grid-cols-3">
      <div className="min-w-0 xl:col-span-2">
        <SeriesCard metrics={seriesMetrics} metric={metric} onMetric={setMetric} labelOf={(m) => t(`series.${m}`)} points={daily(data.current, ids, metric, days)} format={fmt(metric)}
          animate={entrance.animate} index={4} timezone={data.account.timezone ?? timezone} loading={data.reloading} />
      </div>
      <AdsAttention items={items} onDismiss={(id) => void data.mutate(() => data.api.dismissAlert(id)).catch((error) => setNotice(explain(error)))} />
    </div>
    <AdsAccountHealth accounts={data.accounts} checking={checking} onCheck={(id) => void checkHealth(id)} />
  </div>;

  return <div className="flex min-w-0 flex-col gap-6" data-testid="ads-overview" data-entrance={entrance.phase} aria-busy={busy || undefined}>
    {header}
    {notice && <Alert variant="destructive" role="alert"><AlertDescription>{notice}</AlertDescription></Alert>}
    <div className={busy && data.status !== "loading" ? "opacity-60 transition-opacity" : undefined}>{body}</div>
  </div>;
}
