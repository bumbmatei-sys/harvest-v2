"use client";
import { useLocale, useTranslations } from "next-intl";
import { Progress } from "@/components/ui/progress";
import { formatCents, progressPercent, type FundraisingRow } from "@/lib/fundraising";

/**
 * Goal, raised (gifts confirmed by the ministry, net of corrections), progress and open pledges. Shared by the fundraising page and the outreach
 * campaign page. Raised figures exist only for owners and admins (`totals` is null otherwise); pledges are never added to "raised".
 */
export function FundraisingProgress({ row, compact = false }: { row: Pick<FundraisingRow, "goalCents" | "currency" | "totals">; compact?: boolean }) {
  const t = useTranslations("Fundraising.stats"), locale = useLocale();
  const money = (cents: string) => formatCents(cents, row.currency, locale);
  const totals = row.totals, percent = totals ? progressPercent(totals.raisedCents, row.goalCents) : 0;
  const tiles: [string, string, string | null][] = [[t("goal"), money(row.goalCents), null]];
  if (totals) tiles.push([t("raised"), money(totals.raisedCents), t("gifts", { count: totals.giftCount })], [t("pledged"), money(totals.pledgedCents), t("pledges", { count: totals.pledgeCount })]);
  return <div className="space-y-3">
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map(([label, value, note]) => <li key={label} className="min-w-0 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={compact ? "truncate text-xl font-semibold tabular-nums" : "truncate text-2xl font-semibold tabular-nums"}>{value}</p>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </li>)}
    </ul>
    {totals ? <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">{t("progress")}</span><span className="font-medium tabular-nums">{t("ofGoal", { percent })}</span></div>
      <Progress value={Math.min(percent, 100)} aria-label={t("ofGoal", { percent })} />
    </div> : <p className="text-sm text-muted-foreground">{t("raisedHidden")}</p>}
  </div>;
}

/**
 * The public progress block of a give page: raised, goal and percentage as the database released them (live from gifts the ministry recorded, never pledges).
 * `raisedCents` null means small-group suppression: the goal shows, the raised figure and the percentage do not. No donor names exist in this data.
 */
export function GiveProgress({ amount }: { amount: { currency: string; goalCents: string; raisedCents: string | null } }) {
  const t = useTranslations("GivePage.public"), locale = useLocale();
  const money = (cents: string) => formatCents(cents, amount.currency, locale);
  const raised = amount.raisedCents, percent = raised === null ? null : progressPercent(raised, amount.goalCents);
  return <div className="space-y-3" data-give-progress={raised === null ? "suppressed" : "shown"}>
    {raised !== null && percent !== null ? <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-3xl font-semibold tabular-nums" data-give-raised>{money(raised)}</p>
        <p className="text-sm text-muted-foreground tabular-nums">{t("ofGoal", { percent })}</p>
      </div>
      <Progress value={Math.min(percent, 100)} aria-label={t("progressLabel")} />
      <p className="text-sm text-muted-foreground">{t("raisedOf", { raised: money(raised), goal: money(amount.goalCents) })}</p>
    </> : <>
      <div><p className="text-xs text-muted-foreground">{t("goal")}</p><p className="text-3xl font-semibold tabular-nums" data-give-goal>{money(amount.goalCents)}</p></div>
      <p className="text-sm text-muted-foreground">{t("suppressed")}</p>
    </>}
  </div>;
}
