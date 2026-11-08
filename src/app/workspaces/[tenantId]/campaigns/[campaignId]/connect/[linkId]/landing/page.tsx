import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { getLanding } from "@/server/connect-landing";
import { landingPreviewForm } from "@/server/connect-landing-preview";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { LandingEditor } from "@/components/connect-admin/landing-editor";
export const dynamic = "force-dynamic";
export async function generateMetadata() { return { title: (await getTranslations("LandingEditor"))("title"), robots: { index: false, follow: false } }; }
export default async function LandingEditorPage({ params }: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  const session = await pageSession(), { tenantId, campaignId, linkId } = await params;
  if (![tenantId, campaignId, linkId].every(id => uuidInput.safeParse(id).success)) notFound();
  const initial = await getLanding(getDb(), session.user.id, tenantId, campaignId, linkId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!initial) notFound();
  const manifest = await landingPreviewForm(getDb(), session.user.id, tenantId, campaignId, linkId);
  return <LandingEditor initial={initial} manifest={manifest} backHref={`/workspaces/${tenantId}/campaigns/${campaignId}/connect`}
    endpoint={`/api/workspaces/${tenantId}/campaigns/${campaignId}/connect/links/${linkId}/landing`} />;
}
