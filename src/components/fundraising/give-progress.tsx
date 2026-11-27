/** Derived from Shadcn UI Kit item stat-card17 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCents, progressPercent } from "@/lib/fundraising";

/**
 * The public progress block of a give page: raised, goal and percentage as the database released them (live from gifts the ministry recorded, never pledges).
 * `raisedCents` null means small-group suppression: the goal shows, the raised figure and the percentage do not. No donor names exist in this data.
 */
export function GiveProgress({ amount }: { amount: { currency: string; goalCents: string; raisedCents: string | null } }) {
  const t = useTranslations("GivePage.public"), locale = useLocale();
  const money = (cents: string) => formatCents(cents, amount.currency, locale);
  const raised = amount.raisedCents, percent = raised === null ? null : progressPercent(raised, amount.goalCents);
  const used = percent === null ? 0 : percent / 100;
  const remaining = raised === null ? 0n : BigInt(amount.goalCents) - BigInt(raised);

  return (
    <Card className="w-full" data-give-progress={raised === null ? "suppressed" : "shown"}>
      <CardHeader>
        <CardTitle className="text-sm">{raised === null ? t("goal") : t("raised")}</CardTitle>
        <CardDescription className="text-xs">{t("recorded")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {raised !== null && percent !== null ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            <span data-give-raised>{money(raised)}</span>
            <span className="text-muted-foreground ml-1.5 text-sm font-normal">
              {t("ofGoalAmount", { goal: money(amount.goalCents) })}
            </span>
          </p>
          <p className="text-muted-foreground flex items-center gap-1 text-xs font-medium tabular-nums">
            {remaining > 0n
              ? t("toGo", { amount: money(remaining.toString()) })
              : t("goalReached")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Progress
              value={Math.min(used, 1) * 100}
              aria-label={t("progressLabel")}
              aria-valuetext={t("ofGoal", { percent })}
              className="h-1.5 *:data-[slot=progress-indicator]:duration-500"
            />
          </div>
          <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
            <span>{t("ofGoal", { percent })}</span>
            <span className="absolute right-0">{money(amount.goalCents)}</span>
          </div>
        </div>
        </> : <>
        <p className="text-2xl font-semibold tracking-tight tabular-nums" data-give-goal>
          {money(amount.goalCents)}
        </p>
        <p className="text-muted-foreground text-xs">{t("suppressed")}</p>
        </>}
      </CardContent>
    </Card>
  );
}
