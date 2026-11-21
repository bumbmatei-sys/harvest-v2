"use client";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StatusBadge } from "@/components/status-badge";
import { PlatformLogo } from "@/components/social/platform-logo";
import { enter } from "@/components/social/analytics/entrance";
import { ReadingText } from "@/components/social/analytics/reading-text";
import { platformLabels } from "@/lib/social/labels";
import { exposureMetrics, type PostRow } from "@/lib/social/analytics-view";
import { cn } from "@/lib/utils";

/** The post's exposure: the first of reach, impressions and views that was reported for it. */
export const postExposure = (post: PostRow) => exposureMetrics.map((metric) => ({ metric, reading: post.metrics[metric] })).find((item) => item.reading.value !== null) ?? { metric: "reach" as const, reading: post.metrics.reach };

/** Top and bottom posts by engagement. Each row that has a planner record opens its detail; posts published elsewhere are listed without one. */
export function PostsCard({ top, bottom, onOpen, animate, index, timezone }: { top: readonly PostRow[]; bottom: readonly PostRow[]; onOpen: (post: PostRow) => void; animate: boolean; index: number; timezone: string }) {
  const t = useTranslations("SocialAnalytics.posts"), cards = useTranslations("SocialAnalytics.cards"), format = useFormatter(), entry = enter(animate, index);
  const [which, setWhich] = useState<"top" | "bottom">("top");
  const rows = which === "top" ? top : bottom;
  return (
    <Card className={entry.className} style={entry.style} data-testid="posts-card">
      <CardHeader className="@max-md/card:grid!">
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction className="max-md:col-span-full max-md:row-start-3 max-md:mt-3 max-md:justify-self-start">
          <ToggleGroup type="single" variant="outline" value={which} onValueChange={(value) => { if (value) setWhich(value as "top" | "bottom"); }} aria-label={t("order")}>
            <ToggleGroupItem value="top" data-testid="posts-top">{t("top")}</ToggleGroupItem>
            <ToggleGroupItem value="bottom" data-testid="posts-bottom">{t("bottom")}</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="posts-empty">{t("empty")}</p> : (
          <ol className="flex flex-col divide-y" data-testid="posts-list">
            {rows.map((post, position) => {
              const exposure = postExposure(post), linked = post.plannerPostId !== null;
              const body = <>
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-xs font-medium tabular-nums" aria-hidden="true">{position + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium"><PlatformLogo platform={post.platform} className="size-4" />{platformLabels[post.platform]}
                    {!linked && <StatusBadge tone="neutral" label={t("external")} />}</span>
                  <span className="text-xs text-muted-foreground">{format.dateTime(new Date(post.publishedAt), { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <span className="flex shrink-0 gap-4 text-right text-sm">
                  <span className="flex flex-col"><span className="text-xs text-muted-foreground">{cards("engagement")}</span><ReadingText reading={post.metrics.engagement} className="tabular-nums" /></span>
                  <span className="flex flex-col max-sm:hidden"><span className="text-xs text-muted-foreground">{cards(exposure.metric)}</span><ReadingText reading={exposure.reading} className="tabular-nums" /></span>
                </span>
                {linked && <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
              </>;
              return <li key={`${post.connectionId}:${post.ref}`} data-testid="post-row" data-linked={linked}>
                {linked
                  ? <button type="button" onClick={() => onOpen(post)} aria-label={t("open", { platform: platformLabels[post.platform], time: format.dateTime(new Date(post.publishedAt), { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }) })}
                      className={cn("flex min-h-11 w-full items-center gap-3 rounded-md px-1 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50")}>{body}</button>
                  : <div className="flex min-h-11 w-full items-center gap-3 px-1 py-3">{body}</div>}
              </li>;
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
