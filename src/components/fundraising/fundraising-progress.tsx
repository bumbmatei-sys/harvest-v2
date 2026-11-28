/** Derived from Shadcn UI Kit item stat-card7 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCents, progressPercent, type FundraisingRow } from "@/lib/fundraising";

/**
 * Goal, raised (gifts confirmed by the ministry, net of corrections) and open pledges as the kit's usage tiles. Raised figures exist only for owners and
 * admins (`totals` is null otherwise); pledges are never added to "raised" and get no bar toward the goal.
 */
export function FundraisingProgress({ row }: { row: Pick<FundraisingRow, "goalCents" | "currency" | "totals"> }) {
  const t = useTranslations("Fundraising.stats"), locale = useLocale();
  const money = (cents: string) => formatCents(cents, row.currency, locale);
  const totals = row.totals;
  const data: { name: string; stat: string; limit: string | null; percentage: number | null; note: string | null }[] = [
    { name: t("goal"), stat: money(row.goalCents), limit: null, percentage: null, note: null },
  ];
  if (totals) data.push(
    { name: t("raised"), stat: money(totals.raisedCents), limit: money(row.goalCents), percentage: progressPercent(totals.raisedCents, row.goalCents), note: t("gifts", { count: totals.giftCount }) },
    { name: t("pledged"), stat: money(totals.pledgedCents), limit: null, percentage: null, note: t("pledges", { count: totals.pledgeCount }) },
  );

  return (
    <div className="space-y-3">
    <div className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3" data-fundraising-stats>
      {data.map((item) => {
        const high = item.percentage !== null && item.percentage >= 100;
        return (
          <Card key={item.name}>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">{item.name}</p>
              <p className="text-xl font-semibold tracking-tight tabular-nums">
                {item.stat}
                {item.limit && (
                <span className="text-muted-foreground text-sm font-normal">
                  {" "}
                  {t("ofLimit", { limit: item.limit })}
                </span>
                )}
              </p>
              {item.percentage !== null ? (
              <div className="space-y-2">
                <Progress
                  value={Math.min(item.percentage, 100)}
                  aria-label={t("ofGoal", { percent: item.percentage })}
                  className={cn(
                    "h-1.5",
                    high && "*:data-[slot=progress-indicator]:bg-success",
                  )}
                />
                <p className="text-muted-foreground flex items-center justify-between text-xs tabular-nums">
                  {t("ofGoal", { percent: item.percentage })}
                  {high ? (
                    <span className="text-foreground inline-flex items-center gap-1.5 font-medium">
                      <span className="bg-success size-1.5 rounded-full" />
                      {t("goalReached")}
                    </span>
                  ) : (
                    <span>{item.note}</span>
                  )}
                </p>
              </div>
              ) : (
                item.note && <p className="text-muted-foreground text-xs tabular-nums">{item.note}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
    {!totals && <p className="text-muted-foreground text-sm">{t("raisedHidden")}</p>}
    </div>
  );
}
