import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { listCampaigns } from "@/server/newsletter-campaigns/campaigns";
import { getBrandKit } from "@/server/newsletter-campaigns/brand-kit";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { CampaignsList } from "@/components/newsletter/campaigns-list";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterCampaigns");
  return { title: t("pageTitle") };
}

export default async function CampaignsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterCampaigns");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:campaigns")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const [page, kit] = await Promise.all([listCampaigns(db, session.user.id, tenantId, { limit: 100 }), getBrandKit(db, session.user.id, tenantId)]);
  const campaigns = page.items.map((c) => ({ id: c.id, name: c.name, state: c.state, scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null }));
  return <CampaignsList tenantId={tenantId} ministryName={workspace.name} campaigns={campaigns} brand={kit.kit} />;
}
