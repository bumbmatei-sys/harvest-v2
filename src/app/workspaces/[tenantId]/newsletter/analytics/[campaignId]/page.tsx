import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { newsletterCampaignAnalytics } from "@/server/newsletter-campaigns/analytics-overview";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AnalyticsCampaignView } from "@/components/newsletter/analytics-campaign-view";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterAnalytics");
  return { title: t("pageTitle") };
}

/** One campaign's analytics. Owners and admins only; an unknown or foreign campaign is a 404. */
export default async function CampaignAnalyticsPage({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterAnalytics");
  const session = await pageSession(), { tenantId, campaignId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  if (!uuidInput.safeParse(campaignId).success) notFound();
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:analytics")) return <Alert><AlertDescription>{t("noAccess")}</AlertDescription></Alert>;
  const data = await newsletterCampaignAnalytics(db, session.user.id, tenantId, campaignId).catch((error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; });
  if (!data) notFound();
  return <AnalyticsCampaignView tenantId={tenantId} data={data} />;
}
