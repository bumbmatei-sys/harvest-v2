"use client";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ExternalLink } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { PlatformLogo } from "@/components/social/platform-logo";
import { ReadingText } from "@/components/social/analytics/reading-text";
import { usePostDetail } from "@/components/social/analytics/use-analytics";
import { platformLabels } from "@/lib/social/labels";
import { hasAnyValue, postMetricKeys, type PostRow } from "@/lib/social/analytics-view";

const chartConfig = { value: { label: "", color: "var(--chart-1)" } } satisfies ChartConfig;

/** One published planner delivery: every measure the provider reports for it (unreported ones say so), its engagement over the range, and a link to the planner record. */
export function PostSheet({ tenantId, post, range, timezone, onClose }: { tenantId: string; post: PostRow | null; range: { from: string; to: string }; timezone: string; onClose: () => void }) {
  const t = useTranslations("SocialAnalytics.detail"), metricNames = useTranslations("SocialAnalytics.postMetrics"), format = useFormatter();
  const state = usePostDetail(tenantId, post?.plannerPostId ?? null, range, timezone);
  const detail = state.detail?.post;
  const series = detail?.series ?? [];
  const day = (value: string) => format.dateTime(new Date(`${value}T12:00:00Z`), { timeZone: "UTC", month: "short", day: "numeric" });
  return (
    <Sheet open={post !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg" data-testid="post-sheet">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">{post && <PlatformLogo platform={post.platform} className="size-4" colored />}{t("title")}</SheetTitle>
          <SheetDescription>{post ? t("subtitle", { platform: platformLabels[post.platform], time: format.dateTime(new Date(post.publishedAt), { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }) }) : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6" aria-busy={state.status === "loading" || undefined} data-testid="post-detail" data-ready={state.status === "ready" || undefined}>
          {state.status === "loading" && <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>}
          {(state.status === "error" || state.status === "unavailable") && <Alert variant="destructive"><AlertDescription>{state.status === "unavailable" ? t("unavailable") : t("error")}</AlertDescription></Alert>}
          {state.status === "ready" && detail && <>
            {state.detail?.partial && <Alert><AlertDescription>{t("partial")}</AlertDescription></Alert>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3" data-testid="post-metrics">
              {postMetricKeys.map((key) => <div key={key}><dt className="text-xs text-muted-foreground">{metricNames(key)}</dt><dd className="text-lg font-semibold"><ReadingText reading={detail.metrics[key]} /></dd></div>)}
            </dl>
            {hasAnyValue(series) ? (
              <div className="flex flex-col gap-2"><h3 className="text-sm font-medium">{t("engagementOverTime")}</h3>
                <ChartContainer config={chartConfig} className="h-44 w-full">
                  <AreaChart data={series.map((point) => ({ day: point.day, value: point.value }))} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={day} />
                    <YAxis tickLine={false} axisLine={false} width={36} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" labelFormatter={(value) => day(String(value))} />} />
                    <Area dataKey="value" type="monotone" stroke="var(--color-value)" strokeWidth={2} fill="var(--color-value)" fillOpacity={0.12} isAnimationActive={false} />
                  </AreaChart>
                </ChartContainer></div>
            ) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{t("noSeries")}</p>}
            <Button asChild variant="outline" size="responsive" className="self-start"><Link href={`/workspaces/${tenantId}/social/planner?view=queue`}><ExternalLink aria-hidden="true" />{t("openInPlanner")}</Link></Button>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
