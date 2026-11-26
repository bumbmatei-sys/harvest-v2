"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FundraisingProgress } from "@/components/fundraising/fundraising-progress";
import { useRequest } from "@/hooks/use-request";
import { formatCents, type FundraisingRow } from "@/lib/fundraising";

/**
 * Fundraising on the outreach campaign page: goal, raised and progress of its fundraising campaign, or a set-up button that starts one from the
 * campaign's budget settings (CW-09 step 6). Raised figures are owner/admin only; the server leaves them out for anyone else.
 */
export function CampaignFundraisingCard({ tenantId, campaignId, campaignName, fundraising, defaults, canManage }: {
  tenantId: string; campaignId: string; campaignName: string; fundraising: FundraisingRow | null; defaults: { goalCents: string; currency: string } | null; canManage: boolean;
}) {
  const t = useTranslations("Fundraising"), locale = useLocale(), request = useRequest(), router = useRouter();
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [key] = useState(() => crypto.randomUUID());
  const root = `/workspaces/${tenantId}/giving/fundraising`;
  async function setUp() {
    setBusy(true); setError("");
    const result = await request<FundraisingRow>(`/api/workspaces/${tenantId}/fundraising`, { method: "POST", headers: { "Idempotency-Key": key }, body: { title: campaignName, campaignId } });
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    router.push(`${root}/${result.data.id}`);
  }
  return <Card data-slot="campaign-fundraising">
    <CardHeader className="flex flex-wrap items-center justify-between gap-3">
      <CardTitle><h2 className="text-base font-semibold">{t("campaignCard.title")}</h2></CardTitle>
      {fundraising ? <Button asChild variant="outline" className="min-h-11 lg:min-h-9"><Link href={`${root}/${fundraising.id}`}>{t("campaignCard.openFundraiser")}</Link></Button>
        : canManage && defaults ? <Button type="button" className="min-h-11 lg:min-h-9" disabled={busy} onClick={() => void setUp()}>{t("campaignCard.setUp")}</Button> : null}
    </CardHeader>
    <CardContent className="space-y-3">
      {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {fundraising ? <FundraisingProgress row={fundraising} compact />
        : <p className="text-sm text-muted-foreground">{defaults ? t("campaignCard.goalFromBudget", { goal: formatCents(defaults.goalCents, defaults.currency, locale) }) : t("campaignCard.none")}</p>}
    </CardContent>
  </Card>;
}
