import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getDb } from "@/db/client";
import { getCampaign } from "@/server/campaigns";
import { getCampaignBudget } from "@/server/campaign-budget";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { Button } from "@/components/ui/button";
import { CampaignBudget } from "@/components/campaigns/campaign-budget";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("CampaignBudget"))("pageTitle") };
}

// The campaign budget. Everyone who can read campaigns sees planned and spent by category; owners and admins see and change the expenses.
export default async function CampaignBudgetPage({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  const t = await getTranslations("CampaignBudget"), session = await pageSession(), { tenantId, campaignId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(campaignId).success) notFound();
  const missing = (error: unknown) => { if (error instanceof AccessError) return null; throw error; };
  const [campaign, view] = await Promise.all([getCampaign(getDb(), session.user.id, tenantId, campaignId).catch(missing), getCampaignBudget(getDb(), session.user.id, tenantId, campaignId).catch(missing)]);
  if (!campaign || !view) notFound();
  return <div className="space-y-4">
    <Button variant="link" asChild className="h-auto min-h-11 px-0 text-muted-foreground lg:min-h-0"><Link href={`/workspaces/${tenantId}/campaigns/${campaignId}`}><ArrowLeft className="size-4" aria-hidden="true" />{t("backToCampaign")}</Link></Button>
    <div><h1 className="break-words text-2xl font-semibold tracking-tight">{t("pageTitle")}</h1><p className="mt-1 break-words text-sm text-muted-foreground">{campaign.name}</p></div>
    <CampaignBudget tenantId={tenantId} campaignId={campaignId} initial={view} />
  </div>;
}
