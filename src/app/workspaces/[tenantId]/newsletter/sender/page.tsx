import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { senderSetup } from "@/server/newsletter-campaigns/sender-setup";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SenderSetup, type SenderSetupData } from "@/components/newsletter/sender-setup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterSender");
  return { title: t("pageTitle") };
}

export default async function SenderPage({ params }: { params: Promise<{ tenantId: string }> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterSender");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:delivery")) return <Alert><AlertDescription>{t("viewOnly")}</AlertDescription></Alert>;
  const setup = JSON.parse(JSON.stringify(await senderSetup(db, session.user.id, tenantId))) as SenderSetupData;
  return <SenderSetup tenantId={tenantId} initial={setup} />;
}
