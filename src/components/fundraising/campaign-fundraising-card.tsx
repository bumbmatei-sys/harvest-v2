/** Derived from Shadcn UI Kit item stat-card17 (premium), registry retrieved 2026-11-27, approved 2026-11-27 (Giving screens). Kit code; local changes: docs/ui-sources.md. */
"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useRequest } from "@/hooks/use-request";
import { formatCents, progressPercent, type FundraisingRow } from "@/lib/fundraising";

/**
 * Fundraising on the outreach campaign page: goal, raised and progress of its fundraising campaign, or a set-up button that starts one from the
 * campaign's budget settings (CW-09 step 6). Raised figures are owner/admin only; the server leaves them out for anyone else. Pledges never count as raised.
 */
export function CampaignFundraisingCard({ tenantId, campaignId, campaignName, fundraising, defaults, canManage }: {
  tenantId: string; campaignId: string; campaignName: string; fundraising: FundraisingRow | null; defaults: { goalCents: string; currency: string } | null; canManage: boolean;
}) {
  const t = useTranslations("Fundraising"), locale = useLocale(), request = useRequest(), router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [key] = React.useState(() => crypto.randomUUID());
  const root = `/workspaces/${tenantId}/giving/fundraising`;

  async function setUp() {
    setBusy(true); setError("");
    const result = await request<FundraisingRow>(`/api/workspaces/${tenantId}/fundraising`, { method: "POST", headers: { "Idempotency-Key": key }, body: { title: campaignName, campaignId } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.push(`${root}/${result.data.id}`);
  }

  const currency = fundraising?.currency ?? defaults?.currency ?? "USD";
  const money = (cents: string) => formatCents(cents, currency, locale);
  const totals = fundraising?.totals ?? null;
  const percent = fundraising && totals ? progressPercent(totals.raisedCents, fundraising.goalCents) : 0;
  const used = percent / 100;
  const remaining = fundraising && totals ? BigInt(fundraising.goalCents) - BigInt(totals.raisedCents) : 0n;

  return (
    <Card className="w-full" data-slot="campaign-fundraising">
      <CardHeader>
        <CardTitle className="text-sm"><h2>{t("campaignCard.title")}</h2></CardTitle>
        <CardDescription className="text-xs">
          {fundraising ? t(`statuses.${fundraising.status}`) : defaults ? t("campaignCard.goalFromBudget", { goal: formatCents(defaults.goalCents, defaults.currency, locale) }) : t("campaignCard.none")}
        </CardDescription>
        <CardAction>
          {fundraising ? (
            <Button asChild variant="outline" size="sm" className="max-lg:min-h-11">
              <Link href={`${root}/${fundraising.id}`}>{t("campaignCard.openFundraiser")}</Link>
            </Button>
          ) : canManage && defaults ? (
            <Button type="button" size="sm" className="max-lg:min-h-11" disabled={busy} onClick={() => void setUp()}>
              {t("campaignCard.setUp")}
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>
      {(error || fundraising) && (
      <CardContent className="space-y-4">
        {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        {fundraising && totals ? <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {money(totals.raisedCents)}
            <span className="text-muted-foreground ml-1.5 text-sm font-normal">
              {t("stats.ofLimit", { limit: money(fundraising.goalCents) })}
            </span>
          </p>
          <p
            className={cn(
              "flex items-center gap-1 text-xs font-medium tabular-nums",
              remaining > 0n ? "text-muted-foreground" : "text-success",
            )}
          >
            {remaining > 0n
              ? t("stats.toGo", { amount: money(remaining.toString()) })
              : t("stats.goalReached")}
          </p>
        </div>

        <div className="space-y-2">
          <div className="relative">
            <Progress
              value={Math.min(used, 1) * 100}
              aria-label={t("stats.progress")}
              aria-valuetext={t("stats.ofGoal", { percent })}
              className="h-1.5 *:data-[slot=progress-indicator]:duration-500"
            />
          </div>
          <div className="text-muted-foreground relative h-4 text-xs tabular-nums">
            <span>{t("stats.ofGoal", { percent })}</span>
            <span className="absolute right-0">{money(fundraising.goalCents)}</span>
          </div>
        </div>
        </> : fundraising && (
        <>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">{money(fundraising.goalCents)}</p>
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <CircleAlert className="size-3.5" aria-hidden />
            {t("stats.raisedHidden")}
          </p>
        </>
        )}
      </CardContent>
      )}
      {fundraising && totals && (
      <CardFooter className="grid grid-cols-3 divide-x border-t p-0">
        <div className="space-y-1 p-4">
          <p className="text-muted-foreground text-xs">{t("stats.goal")}</p>
          <p className="text-sm font-semibold tabular-nums">
            {money(fundraising.goalCents)}
          </p>
        </div>
        <div className="space-y-1 p-4">
          <p className="text-muted-foreground text-xs">{t("stats.pledged")}</p>
          <p className="flex items-center gap-1 text-sm font-semibold tabular-nums">
            {money(totals.pledgedCents)}
          </p>
        </div>
        <div className="space-y-1 p-4">
          <p className="text-muted-foreground text-xs">{t("stats.giftsLabel")}</p>
          <p className="text-sm font-semibold tabular-nums">
            {totals.giftCount}
          </p>
        </div>
      </CardFooter>
      )}
    </Card>
  );
}
