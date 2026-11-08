import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Eye } from "lucide-react";
import { getDb } from "@/db/client";
import { getLanding } from "@/server/connect-landing";
import { landingPreviewForm } from "@/server/connect-landing-preview";
import { ResponseForm } from "@/components/connect/response-form";
import { getConnectLink } from "@/server/connect-links";
import { pageSession } from "@/server/page-session";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { campaignLanding } from "@/lib/connect-public";
import { effectiveStatus } from "@/lib/connect-links";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LandingContent } from "@/components/connect/landing-view";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ConnectLinks"))("previewTitle"), robots: { index: false, follow: false } };
}

// Test/preview mode: the public page as this link would render it, inside the signed-in app.
// It works for drafts and paused links, is never public and records nothing.
export default async function LinkPreview({ params }: { params: Promise<{ tenantId: string; campaignId: string; linkId: string }> }) {
  const t = await getTranslations("ConnectLinks"), session = await pageSession(), { tenantId, campaignId, linkId } = await params;
  if (![tenantId, campaignId, linkId].every((id) => uuidInput.safeParse(id).success)) notFound();
  const data = await getConnectLink(getDb(), session.user.id, tenantId, campaignId, linkId)
    .catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!data) notFound();
  const draft = await getLanding(getDb(), session.user.id, tenantId, campaignId, linkId);
  const manifest = await landingPreviewForm(getDb(), session.user.id, tenantId, campaignId, linkId);
  const status = effectiveStatus(data.link.status, data.link.expiresAt);
  return <div className="space-y-6">
    <Button variant="link" asChild className="h-auto min-h-11 px-0 text-muted-foreground lg:min-h-0"><Link href={`/workspaces/${tenantId}/campaigns/${campaignId}/connect`}><ArrowLeft className="size-4" aria-hidden="true" />{t("title")}</Link></Button>
    <Alert><Eye aria-hidden="true" /><AlertTitle><h1>{t("previewHeading", { name: data.link.label ?? t("untitled") })}</h1></AlertTitle>
      <AlertDescription><p>{t("previewNotice")}</p><p>{t("previewStatus", { status: t(`statuses.${status}`) })}</p></AlertDescription></Alert>
    <section aria-label={t("previewTitle")} className="rounded-xl border bg-background px-4 py-10 sm:px-8 sm:py-14">
      <LandingContent landing={campaignLanding("en", data.link.publicTitle, draft.revision ? draft.definition : undefined)} responseHref={manifest ? "#response-form" : undefined} invitationAvailable={Boolean(manifest?.purposes.includes("account_communications"))} preview />
      {manifest && <ResponseForm manifest={manifest} endpoint="" preview />}
    </section>
  </div>;
}
