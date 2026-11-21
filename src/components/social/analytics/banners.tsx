"use client";
import Link from "next/link";
import { CircleAlert, Clock, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { accountIssues, type AccountReport } from "@/lib/social/analytics-view";

/** The last refresh time. "Not updated yet" when no account has completed a refresh. */
export function Freshness({ at, timezone }: { at: string | null; timezone: string }) {
  const t = useTranslations("SocialAnalytics.freshness"), format = useFormatter();
  return <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="freshness"><RefreshCw className="size-3.5" aria-hidden="true" />
    {at ? t("updated", { time: format.dateTime(new Date(at), { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }) }) : t("never")}</p>;
}

const names = (accounts: readonly AccountReport[], limit = 3) => accounts.slice(0, limit).map((account) => account.displayName).join(", ") + (accounts.length > limit ? ` +${accounts.length - limit}` : "");

/** Partial-result banners: an account that is delayed or whose connection expired, accounts not measured yet, and a truncated report. Numbers that are present stay on screen. */
export function PartialBanners({ accounts, truncated, accountsHref }: { accounts: readonly AccountReport[]; truncated: boolean; accountsHref: string }) {
  const t = useTranslations("SocialAnalytics.banners"), issues = accountIssues(accounts);
  if (!issues.expired.length && !issues.delayed.length && !issues.pending.length && !truncated) return null;
  return <div className="flex flex-col gap-3" data-testid="partial-banners">
    {issues.expired.length > 0 && <Alert variant="destructive" data-testid="banner-expired"><CircleAlert aria-hidden="true" />
      <AlertTitle>{t("expiredTitle", { count: issues.expired.length })}</AlertTitle>
      <AlertDescription><p>{t("expired", { names: names(issues.expired) })}</p>
        <Button asChild variant="outline" size="responsive" className="mt-2"><Link href={accountsHref}>{t("reconnect")}</Link></Button></AlertDescription></Alert>}
    {issues.delayed.length > 0 && <Alert data-testid="banner-delayed"><Clock aria-hidden="true" />
      <AlertTitle>{t("delayedTitle", { count: issues.delayed.length })}</AlertTitle>
      <AlertDescription>{t("delayed", { names: names(issues.delayed) })}</AlertDescription></Alert>}
    {issues.pending.length > 0 && <Alert data-testid="banner-pending"><Clock aria-hidden="true" />
      <AlertTitle>{t("pendingTitle", { count: issues.pending.length })}</AlertTitle>
      <AlertDescription>{t("pending", { names: names(issues.pending) })}</AlertDescription></Alert>}
    {truncated && <Alert data-testid="banner-truncated"><CircleAlert aria-hidden="true" />
      <AlertTitle>{t("truncatedTitle")}</AlertTitle><AlertDescription>{t("truncated")}</AlertDescription></Alert>}
  </div>;
}
