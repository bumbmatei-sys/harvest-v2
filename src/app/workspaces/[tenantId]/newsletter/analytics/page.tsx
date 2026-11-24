import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { newsletterEnabled } from "@/server/newsletter";
import { newsletterAnalyticsOverview } from "@/server/newsletter-campaigns/analytics-overview";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { parsePeriod } from "@/lib/newsletter-analytics";
import { AccessState } from "@/components/access-state";
import { AnalyticsView } from "@/components/newsletter/analytics-view";
import { Alert, AlertDescription } from "@/components/ui/alert";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewsletterAnalytics");
  return { title: t("pageTitle") };
}

/** Newsletter analytics: aggregate delivery figures. Owners and admins only; everyone else gets the no-access note. */
export default async function NewsletterAnalyticsPage({ params, searchParams }: { params: Promise<{ tenantId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!newsletterEnabled()) notFound();
  const t = await getTranslations("NewsletterAnalytics");
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AccessState />;
  if (!can(workspace.role, "newsletter:analytics")) return <Alert><AlertDescription>{t("noAccess")}</AlertDescription></Alert>;
  const overview = await newsletterAnalyticsOverview(db, session.user.id, tenantId, parsePeriod((await searchParams).period));
  return <AnalyticsView tenantId={tenantId} overview={overview} />;
}
