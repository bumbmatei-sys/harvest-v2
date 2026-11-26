import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled, pageNewsletterConfiguration } from "@/server/newsletter";
import { getCampaign } from "@/server/newsletter-campaigns/campaigns";
import { getBrandKit } from "@/server/newsletter-campaigns/brand-kit";
import { listIdentities } from "@/server/newsletter-campaigns/identities";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { timeZoneOrDefault } from "@/lib/time-zone";
import { AccessState } from "@/components/access-state";
import { thumbnailSuggestionsEnabled } from "@/server/newsletter-campaigns/images";
import { CampaignEditor } from "@/components/newsletter/campaign-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterCampaigns");
  return { title: t("pageTitle") };
}

export default async function CampaignEditorPage({ params }: { params: Promise<{ tenantId: string; campaignId: string }> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterCampaigns");
  const session = await pageSession(), { tenantId, campaignId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(campaignId).success) return <AccessState />;
  const db = getDb(), user = session.user.id;
  const workspace = await getWorkspace(db, user, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:campaigns")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const missing = (error: unknown) => { if (error instanceof AccessError && error.status === 404) return null; throw error; };
  const campaign = await getCampaign(db, user, tenantId, campaignId).catch(missing);
  if (!campaign) notFound();
  const [kit, lists, segments, identities] = await Promise.all([getBrandKit(db, user, tenantId), pageNewsletterConfiguration(db, user, tenantId, "lists", { limit: 100 }),
    pageNewsletterConfiguration(db, user, tenantId, "segments", { limit: 100 }), listIdentities(db, user, tenantId, { limit: 100 }).catch(() => ({ items: [] }))]);
  const option = (row: { id: string; name: string; audienceId?: string }) => ({ id: row.id, name: row.name, audienceId: row.audienceId ?? "" });
  const senders = identities.items.filter((row) => row.identity.ownershipVerified).map((row) => ({ id: row.identity.id, address: row.identity.address, displayName: row.identity.displayName }));
  return <CampaignEditor suggestions={thumbnailSuggestionsEnabled()} tenantId={tenantId} ministryName={workspace.name} timeZone={timeZoneOrDefault(workspace.timeZone)} brandKit={{ kit: kit.kit, version: kit.version }} lists={lists.items.map(option)} groups={segments.items.map(option)} senders={senders}
    campaign={{ id: campaign.id, name: campaign.name, state: campaign.state, version: campaign.version, subject: campaign.subject, preheader: campaign.preheader, senderId: campaign.senderId, replyToId: campaign.replyToId, content: campaign.content, selection: campaign.selection,
      scheduledAt: campaign.scheduledAt?.toISOString() ?? null, timezone: campaign.timezone, frozenAt: campaign.frozenAt?.toISOString() ?? null }} />;
}
