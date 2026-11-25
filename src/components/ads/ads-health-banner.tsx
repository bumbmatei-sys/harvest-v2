"use client";
import { AlertTriangle, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { healthChecks } from "@/lib/ads/ads";
import type { AdAccountView, AdsAlert } from "@/lib/ads/view";

/** Account health and the needs-attention list: one banner above the table, only when something needs a person. Every line is plain text, so colour is never the only signal. */
export function AdsHealthBanner({ account, alerts, onDismiss }: { account: AdAccountView; alerts: readonly AdsAlert[]; onDismiss: (id: string) => void }) {
  const t = useTranslations("Ads.health");
  const checks = healthChecks.filter((name) => ["warning", "failing"].includes(account.health[name]?.state ?? "unknown"));
  const restricted = account.status !== "active" && account.status !== "unknown";
  if (!restricted && !checks.length && !alerts.length && !account.lastRefusal && account.syncState !== "failing") return null;
  return <Alert variant="attention" role="status" data-ads-health>
    <AlertTriangle aria-hidden="true" />
    <AlertTitle>{restricted ? t("accountStatus", { status: t(`status.${account.status}`) }) : t("needsAttention")}</AlertTitle>
    <AlertDescription>
      <ul className="mt-1 space-y-1">
        {account.syncState === "failing" && <li>{t("syncFailing")}</li>}
        {checks.map((name) => { const check = account.health[name]; return <li key={name}>{t(`check.${name}.${check.state === "failing" ? "failing" : "warning"}`)}
          {check.fixUrl && <> <a className="font-medium underline underline-offset-4" href={check.fixUrl} target="_blank" rel="noreferrer noopener">{t("fix")}</a></>}</li>; })}
        {account.lastRefusal && <li>{t("lastRefusal")}{account.lastRefusal.fixUrl && <> <a className="font-medium underline underline-offset-4" href={account.lastRefusal.fixUrl} target="_blank" rel="noreferrer noopener">{t("fix")}</a></>}</li>}
        {alerts.map((alert) => <li key={alert.id} className="flex items-center gap-2"><span className="min-w-0 flex-1">{t(`alert.${alert.kind}`)}</span>
          <Button type="button" variant="ghost" size="icon" className="size-11 lg:size-8" aria-label={t("dismiss", { alert: t(`alert.${alert.kind}`) })} onClick={() => onDismiss(alert.id)}><X aria-hidden="true" /></Button></li>)}
      </ul>
    </AlertDescription>
  </Alert>;
}
