import { getFormatter, getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { ConsentForm } from "@/components/consent-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Permission = { purpose: "messaging" | "form_follow_up" | "newsletter"; status: "granted" | "withdrawn" | "none"; at: string | null; source: string | null };
const channels = { messaging: "social", form_follow_up: "email", newsletter: "email" } as const;
const tone = { granted: "bg-success-tint text-success", withdrawn: "bg-warning-tint text-warning", none: "text-muted-foreground" } as const;

/**
 * CRM-07: one opt-in per purpose, never bundled. Each row shows the effective state from the
 * consent ledger (a withdrawal wins) and when and how it was recorded; writers record the next choice.
 */
export async function ContactPermissions({ tenantId, contactId, permissions, writable }: { tenantId: string; contactId: string; permissions: Permission[]; writable: boolean }) {
  const t = await getTranslations("Associations");
  const format = await getFormatter();
  return <Card className="gap-3">
    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" /><h2>{t("permissionsTitle")}</h2></CardTitle>
      <CardDescription className="text-xs">{t("permissionsDescription")}</CardDescription></CardHeader>
    <CardContent><ul className="divide-y" aria-label={t("permissionsTitle")}>{permissions.map((item) => <li key={item.purpose} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-48">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{t(`purposes.${item.purpose}`)}
          <Badge variant="secondary" className={cn("h-5 rounded-md px-1.5 text-[11px] font-normal", tone[item.status])}>{t(`status.${item.status}`)}</Badge></p>
        <p className="mt-0.5 text-xs text-muted-foreground">{t(`purposeHelp.${item.purpose}`)}</p>
        {item.at && <p className="mt-0.5 text-xs [overflow-wrap:anywhere] text-muted-foreground">{t(item.status === "withdrawn" ? "withdrawnOn" : "grantedOn", { date: format.dateTime(new Date(item.at), "date"), source: item.source ?? t("unknownSource") })}</p>}
      </div>
      {writable && <ConsentForm tenantId={tenantId} contactId={contactId} preset={{ purpose: item.purpose, status: item.status === "granted" ? "withdrawn" : "granted", channel: channels[item.purpose] }}
        trigger={<Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-8" aria-label={t(item.status === "granted" ? "recordWithdrawalFor" : "recordOptInFor", { purpose: t(`purposes.${item.purpose}`) })}>
          {t(item.status === "granted" ? "recordWithdrawal" : "recordOptIn")}</Button>} />}
    </li>)}</ul></CardContent>
  </Card>;
}
