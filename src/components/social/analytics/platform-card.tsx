"use client";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { PlatformLogo } from "@/components/social/platform-logo";
import { enter } from "@/components/social/analytics/entrance";
import { ReadingText } from "@/components/social/analytics/reading-text";
import { platformLabels } from "@/lib/social/labels";
import type { AccountReport, PlatformReport } from "@/lib/social/analytics-view";

function platformStatus(accounts: readonly AccountReport[]): "expired" | "delayed" | "pending" | null {
  if (accounts.some((account) => account.status === "expired")) return "expired";
  if (accounts.some((account) => account.status === "delayed" || account.status === "partial")) return "delayed";
  if (accounts.some((account) => account.status === "pending")) return "pending";
  return null;
}

/** One row per platform with the same four measures as the cards. On a phone each platform is a stacked block, so nothing needs sideways scrolling. */
export function PlatformCard({ platforms, accounts, exposureLabel, animate, index }: {
  platforms: readonly PlatformReport[]; accounts: readonly AccountReport[]; exposureLabel: string; animate: boolean; index: number;
}) {
  const t = useTranslations("SocialAnalytics.platforms"), cards = useTranslations("SocialAnalytics.cards"), entry = enter(animate, index);
  const statusLabel = { expired: t("statusExpired"), delayed: t("statusDelayed"), pending: t("statusPending") } as const;
  const rows = platforms.map((platform) => {
    const status = platformStatus(accounts.filter((account) => account.platform === platform.platform));
    return { platform, status, label: platformLabels[platform.platform] };
  });
  const measures = [
    { key: "published", label: cards("published"), get: (row: PlatformReport) => row.summary.published },
    { key: "exposure", label: exposureLabel, get: (row: PlatformReport) => row.summary.exposure.reading },
    { key: "engagement", label: cards("engagement"), get: (row: PlatformReport) => row.summary.engagement },
    { key: "followerChange", label: cards("followerChange"), get: (row: PlatformReport) => row.summary.followerChange, signed: true },
  ];
  return (
    <Card className={entry.className} style={entry.style} data-testid="platform-card">
      <CardHeader><CardTitle>{t("title")}</CardTitle><CardDescription>{t("description")}</CardDescription></CardHeader>
      <CardContent>
        <table className="hidden w-full text-sm sm:table" data-testid="platform-table">
          <thead><tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="py-2 pr-3 font-medium">{t("platform")}</th>
            {measures.map((measure) => <th key={measure.key} scope="col" className="px-3 py-2 text-right font-medium">{measure.label}</th>)}
          </tr></thead>
          <tbody>{rows.map(({ platform, status, label }) => <tr key={platform.platform} className="border-b last:border-0" data-platform={platform.platform}>
            <th scope="row" className="py-3 pr-3 text-left font-medium"><span className="flex flex-wrap items-center gap-2"><PlatformLogo platform={platform.platform} className="size-4" />{label}{status && <StatusBadge tone={status === "expired" ? "danger" : "warning"} label={statusLabel[status]} />}</span></th>
            {measures.map((measure) => <td key={measure.key} className="px-3 py-3 text-right tabular-nums"><ReadingText reading={measure.get(platform)} signed={measure.signed} /></td>)}
          </tr>)}</tbody>
        </table>
        <ul className="flex flex-col divide-y sm:hidden">
          {rows.map(({ platform, status, label }) => <li key={platform.platform} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0" data-platform={platform.platform}>
            <span className="flex flex-wrap items-center gap-2 font-medium"><PlatformLogo platform={platform.platform} className="size-4" />{label}{status && <StatusBadge tone={status === "expired" ? "danger" : "warning"} label={statusLabel[status]} />}</span>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">{measures.map((measure) => <div key={measure.key}><dt className="text-xs text-muted-foreground">{measure.label}</dt>
              <dd className="tabular-nums"><ReadingText reading={measure.get(platform)} signed={measure.signed} /></dd></div>)}</dl>
          </li>)}
        </ul>
      </CardContent>
    </Card>
  );
}
