"use client";
import Link from "next/link";
import { useState } from "react";
import { ChartNoAxesCombined, RotateCw, UserCog } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Freshness, PartialBanners } from "@/components/social/analytics/banners";
import { useEntrance } from "@/components/social/analytics/entrance";
import { HeatmapCard } from "@/components/social/analytics/heatmap-card";
import { PlatformCard } from "@/components/social/analytics/platform-card";
import { PostSheet } from "@/components/social/analytics/post-sheet";
import { PostsCard } from "@/components/social/analytics/posts-card";
import { RangePicker } from "@/components/social/analytics/range-picker";
import { useNumberFormat } from "@/components/social/analytics/reading-text";
import { SeriesCard } from "@/components/social/analytics/series-card";
import { StatCard } from "@/components/social/analytics/stat-card";
import { useAnalytics } from "@/components/social/analytics/use-analytics";
import { deltaOf, hasNoData, parseScope, presetRange, scopeValue, todayIn, daysInRange, type PostRow, type Scope, type SeriesMetric } from "@/lib/social/analytics-view";
import { platformLabels } from "@/lib/social/labels";
import { browserTimeZone } from "@/lib/social/time";

function LoadingState() {
  return <div className="flex flex-col gap-4 lg:gap-6" data-testid="analytics-loading">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6">
      {[0, 1, 2, 3].map((item) => <Card key={item}><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent className="flex flex-col gap-3"><Skeleton className="h-9 w-24" /><Skeleton className="h-4 w-36" /><Skeleton className="h-12 w-full" /></CardContent></Card>)}
    </div>
    <Card><CardHeader><Skeleton className="h-5 w-40" /></CardHeader><CardContent><Skeleton className="h-64 w-full" /></CardContent></Card>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 lg:gap-6">
      <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
      <Card><CardHeader><Skeleton className="h-5 w-32" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
    </div>
  </div>;
}

/**
 * Social media > Analytics. Owner and admin only (the page and the routes both enforce it). It reads the Analytics routes and never triggers a refresh:
 * numbers come from stored snapshots, and a missing measure is shown as "Unavailable", never as zero. The entrance (cards rise in, charts draw, numbers
 * count up) plays once per visit and never for refreshes or when the system asks for reduced motion.
 */
export function AnalyticsDashboard({ tenantId }: { tenantId: string }) {
  const t = useTranslations("SocialAnalytics"), cards = useTranslations("SocialAnalytics.cards"), format = useNumberFormat();
  const [timezone] = useState(() => browserTimeZone()), [today] = useState(() => todayIn(timezone));
  const [range, setRange] = useState(() => presetRange(28, today)), [scope, setScope] = useState<Scope>({ kind: "all" });
  const [metric, setMetric] = useState<SeriesMetric>("engagement"), [opened, setOpened] = useState<PostRow | null>(null);
  const data = useAnalytics(tenantId, range, timezone, scope);
  const entrance = useEntrance(data.status === "ready");
  const report = data.report, accountsHref = `/workspaces/${tenantId}/social/accounts`;
  const busy = data.status === "loading" || data.reloading;
  const platforms = [...new Set(data.accounts.map((account) => account.platform))];
  const exposure = report?.summary.exposure.metric ?? "reach";
  const labelOf = (item: SeriesMetric) => item === "published" ? cards("published") : item === "followerChange" ? cards("followerChange") : item === "engagement" ? cards("engagement") : cards(item);
  const length = daysInRange(range.from, range.to), period = t("range.previous", { days: length });
  const metrics: SeriesMetric[] = ["published", exposure, "engagement", "followerChange"];
  const selected = metrics.includes(metric) ? metric : "engagement";

  const stat = (key: SeriesMetric, reading: NonNullable<typeof report>["summary"]["published"], previous: NonNullable<typeof report>["summary"]["published"] | undefined, index: number, signed = false) =>
    <StatCard key={key} label={labelOf(key)} reading={reading} delta={deltaOf(reading, previous)} points={data.series[key] ?? []} animate={entrance.animate} index={index} signed={signed} format={format} periodLabel={period} />;

  const header = <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
    <div className="min-w-0"><h1 className="text-[28px] font-semibold tracking-tight">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("subtitle", { zone: timezone })}</p></div>
    <div className="flex min-w-0 flex-wrap items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
      {data.accounts.length > 1 && <NativeSelect value={scopeValue(scope)} onChange={(event) => setScope(parseScope(event.target.value))} className="min-h-11 w-auto min-w-44 max-sm:w-full lg:min-h-9" aria-label={t("scope.label")} data-testid="scope-select">
        <NativeSelectOption value="all">{t("scope.all")}</NativeSelectOption>
        {platforms.length > 1 && <NativeSelectOptGroup label={t("scope.platforms")}>{platforms.map((platform) => <NativeSelectOption key={platform} value={`platform:${platform}`}>{platformLabels[platform]}</NativeSelectOption>)}</NativeSelectOptGroup>}
        <NativeSelectOptGroup label={t("scope.accounts")}>{data.accounts.map((account) => <NativeSelectOption key={account.id} value={`account:${account.id}`}>{t("scope.account", { name: account.displayName, platform: platformLabels[account.platform] })}</NativeSelectOption>)}</NativeSelectOptGroup>
      </NativeSelect>}
      <RangePicker range={range} today={today} onChange={setRange} />
    </div>
  </header>;

  let body: React.ReactNode;
  if (data.status === "loading") body = <LoadingState />;
  else if (data.status === "unavailable") body = <EmptyState icon={ChartNoAxesCombined} title={t("states.unavailableTitle")} description={t("states.unavailable")} solid />;
  else if (data.status === "error" || !report) body = <Alert variant="destructive" data-testid="analytics-error"><AlertDescription className="flex flex-wrap items-center gap-3">{t("states.error")}
    <Button type="button" variant="outline" size="responsive" onClick={data.retry}><RotateCw aria-hidden="true" />{t("states.retry")}</Button></AlertDescription></Alert>;
  else if (data.accounts.length === 0 && report.accounts.length === 0) body = <EmptyState icon={UserCog} title={t("states.noAccountsTitle")} description={t("states.noAccounts")} solid
    action={<Button asChild size="responsive"><Link href={accountsHref}>{t("states.connect")}</Link></Button>} />;
  else body = <div className="flex flex-col gap-4 lg:gap-6" data-testid="analytics-content">
    <div className="flex flex-wrap items-center justify-between gap-2"><Freshness at={report.lastRefreshedAt} timezone={timezone} /></div>
    <PartialBanners accounts={report.accounts} truncated={report.truncated} accountsHref={accountsHref} />
    {hasNoData(report) ? <EmptyState icon={ChartNoAxesCombined} title={t("states.noDataTitle")} description={t("states.noData")} solid className="min-h-[200px]" /> : <>
      <section aria-label={t("cards.group")} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 lg:gap-6">
        {stat("published", report.summary.published, data.previous?.published, 0)}
        {stat(exposure, report.summary.exposure.reading, data.previous?.[exposure], 1)}
        {stat("engagement", report.summary.engagement, data.previous?.engagement, 2)}
        {stat("followerChange", report.summary.followerChange, data.previous?.followerChange, 3, true)}
      </section>
      <SeriesCard metrics={metrics} metric={selected} onMetric={setMetric} labelOf={labelOf} points={data.series[selected] ?? []} animate={entrance.animate} index={4} timezone={report.range.timezone} loading={busy} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 lg:gap-6">
        <PlatformCard platforms={report.platforms} accounts={report.accounts} exposureLabel={labelOf(exposure)} animate={entrance.animate} index={5} />
        <PostsCard top={report.topPosts} bottom={report.bottomPosts} onOpen={setOpened} animate={entrance.animate} index={6} timezone={report.range.timezone} />
      </div>
      <HeatmapCard observed={report.bestTimes.heatmap} provider={report.bestTimes.provider.heatmap} timezone={report.bestTimes.timezone} providerTimezone={report.bestTimes.provider.timezone} animate={entrance.animate} index={7} />
    </>}
  </div>;

  return <div className="flex flex-col gap-6" data-testid="analytics-page" data-entrance={entrance.phase} data-ready={data.status === "ready" && !data.reloading ? "true" : undefined} aria-busy={busy || undefined}>
    {header}
    <div className={busy && data.status !== "loading" ? "opacity-60 transition-opacity" : undefined}>{body}</div>
    <PostSheet tenantId={tenantId} post={opened} range={range} timezone={timezone} onClose={() => setOpened(null)} />
  </div>;
}
