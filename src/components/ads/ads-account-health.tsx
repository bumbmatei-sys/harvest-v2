/** Layout modelled on the dashboard cards already approved for Social Analytics and the CRM reports (shared Card, StatusBadge); code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import type { StatusTone } from "@/lib/status-tone";
import { healthRows, healthSummary } from "@/lib/ads/overview";
import type { AdAccountView } from "@/lib/ads/view";

const tone: Record<"ok" | "warning" | "failing" | "unknown", StatusTone> = { ok: "success", warning: "warning", failing: "danger", unknown: "pending" };

/** One card per connected ad account: its status, each named health check (a check the network never answered reads Not confirmed, never OK) and a Check now action. */
export function AdsAccountHealth({ accounts, checking, onCheck }: { accounts: readonly AdAccountView[]; checking: string | null; onCheck: (id: string) => void }) {
  const t = useTranslations("Ads.overview.health"), l = useTranslations("Ads"), format = useFormatter();
  return <section aria-labelledby="ads-health-title" className="flex flex-col gap-4" data-ads-account-health>
    <h2 id="ads-health-title" className="text-lg font-semibold">{t("title")}</h2>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
      {accounts.map((account) => {
        const summary = healthSummary(account);
        return <Card key={account.id} className="min-w-0" data-ads-health-account={account.name}>
          <CardHeader>
            <CardTitle className="break-words">{account.name}</CardTitle>
            <CardDescription>{l.has(`networks.${account.network}`) ? l(`networks.${account.network}`) : l("networks.other")}{account.currency ? ` · ${account.currency}` : ""}</CardDescription>
            <CardAction><StatusBadge tone={tone[summary]} dot label={t(`summary.${summary}`)} /></CardAction>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2" aria-label={t("checks", { name: account.name })}>
              {healthRows(account).map((row) => <li key={row.name} className="flex min-h-11 items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
                <span className="min-w-0">{t(`check.${row.name}`)}{row.fixUrl && row.state !== "ok" && <> <a className="font-medium underline underline-offset-4" href={row.fixUrl} target="_blank" rel="noreferrer noopener">{l("health.fix")}</a></>}</span>
                <StatusBadge tone={tone[row.state]} label={t(`state.${row.state}`)} className="shrink-0" />
              </li>)}
            </ul>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">{account.healthCheckedAt ? t("checkedAt", { time: format.dateTime(new Date(account.healthCheckedAt), { dateStyle: "medium", timeStyle: "short" }) }) : t("never")}</span>
            <Button type="button" variant="outline" size="responsive" disabled={checking !== null} onClick={() => onCheck(account.id)} aria-label={t("checkNamed", { name: account.name })}>
              <RotateCw aria-hidden="true" />{checking === account.id ? t("checking") : t("check")}</Button>
          </CardFooter>
        </Card>;
      })}
    </div>
  </section>;
}
