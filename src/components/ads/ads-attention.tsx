/** Layout modelled on the dashboard list cards already approved for Social Analytics and the CRM reports (shared Card, StatusBadge, EmptyState); code written for Harvest, no kit code copied. Notes: docs/ui-sources.md. */
"use client";
import { CircleCheck, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import type { AttentionItem } from "@/lib/ads/overview";

/** The needs-attention list: account problems, open alerts, rejected ads, delivery issues, budgets nearly spent and rule flags. Each line is text, so colour is never the only signal. */
export function AdsAttention({ items, onDismiss }: { items: readonly AttentionItem[]; onDismiss: (alertId: string) => void }) {
  const t = useTranslations("Ads.overview.attention"), h = useTranslations("Ads.health"), l = useTranslations("Ads"), format = useFormatter();
  const text = (item: AttentionItem) => {
    switch (item.kind) {
      case "accountStatus": return h("accountStatus", { status: h.has(`status.${item.detail}`) ? h(`status.${item.detail}`) : h("status.unknown") });
      case "syncFailing": return h("syncFailing");
      case "healthCheck": return h.has(`check.${item.detail}`) ? h(`check.${item.detail}`) : t("healthCheck");
      case "lastRefusal": return h("lastRefusal");
      case "alert": return h.has(`alert.${item.detail}`) ? h(`alert.${item.detail}`) : t("alert");
      case "adRejected": return t("adRejected");
      case "deliveryIssue": return t("deliveryIssue");
      case "budgetNearlySpent": return t(item.detail === "lifetime" ? "budgetLifetime" : "budgetDaily", { share: format.number(item.share ?? 0, { style: "percent", maximumFractionDigits: 0 }) });
      case "ruleFlag": return t("ruleFlag", { rule: item.detail ?? "" });
    }
  };
  return <Card className="min-w-0" data-ads-attention>
    <CardHeader>
      <CardTitle>{t("title")}</CardTitle>
      <CardDescription>{t("description")}</CardDescription>
      {items.length > 0 && <CardAction><StatusBadge tone={items.some((i) => i.severity === "critical") ? "danger" : "warning"} label={t("count", { count: items.length })} /></CardAction>}
    </CardHeader>
    <CardContent>
      {items.length === 0
        ? <EmptyState icon={CircleCheck} size="compact" title={t("noneTitle")} description={t("none")} />
        : <ul className="flex flex-col divide-y" aria-label={t("title")}>
          {items.map((item) => <li key={item.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" data-attention={item.kind}>
            <StatusBadge tone={item.severity === "critical" ? "danger" : "warning"} dot label={t(item.severity)} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="break-words">{text(item)}</p>
              {item.subject && <p className="mt-0.5 break-words text-muted-foreground">{t("subject", { level: l(`levels.${item.subject.level}`), name: item.subject.name })}</p>}
              {item.fixUrl && <a className="mt-1 inline-flex min-h-11 items-center font-medium underline underline-offset-4 lg:min-h-0" href={item.fixUrl} target="_blank" rel="noreferrer noopener">{h("fix")}</a>}
            </div>
            {item.alertId && <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 lg:size-8" aria-label={h("dismiss", { alert: text(item) })} onClick={() => onDismiss(item.alertId!)}><X aria-hidden="true" /></Button>}
          </li>)}
        </ul>}
    </CardContent>
  </Card>;
}
