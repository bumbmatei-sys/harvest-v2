import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Kanban } from "lucide-react";
import { isStale, type StageColor, type StageKind } from "@/lib/crm-deals";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StaleBadge, StageBadge } from "./stage-badge";

export type RelatedDeal = { id: string; name: string; amount: string | null; expectedCloseDate: string | null; stageName: string; stageKind: StageKind; stageColor: StageColor };

/** Related deals card for company and person records (shown only to readers of deals). */
export async function RelatedDeals({ tenantId, deals, today, action }: { tenantId: string; deals: RelatedDeal[]; today: string; action?: React.ReactNode }) {
  const t = await getTranslations("Deals");
  const format = await getFormatter();
  return <Card className="gap-3">
    <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Kanban className="size-4 text-muted-foreground" aria-hidden="true" />{t("relatedDeals")}<Badge variant="secondary" className="rounded-md tabular-nums">{format.number(deals.length, "integer")}</Badge></CardTitle>
      {action && <CardAction>{action}</CardAction>}</CardHeader>
    <CardContent>{deals.length ? <ul className="divide-y" aria-label={t("relatedDeals")}>{deals.map((deal) => <li key={deal.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
      <Link href={`/workspaces/${tenantId}/crm/deals/${deal.id}`} className="min-w-0 flex-1 basis-40 truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">{deal.name}</Link>
      <StageBadge name={deal.stageName} color={deal.stageColor} />
      {deal.amount !== null && <span className="text-xs tabular-nums">{format.number(Number(deal.amount), { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</span>}
      {isStale(deal.stageKind, deal.expectedCloseDate, today) && <StaleBadge label={t("stale")} />}
    </li>)}</ul> : <p className="text-xs text-muted-foreground">{t("noRelatedDeals")}</p>}</CardContent>
  </Card>;
}
