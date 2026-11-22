import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { getCrmReport } from "@/server/crm-reports";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { ReportsView } from "@/components/crm/reports/reports-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("CrmReports");
  return { title: t("pageTitle") };
}

/** CRM reports. Owners and admins see ministry totals, members only their own work; viewers (and strangers) get the neutral access state. */
export default async function CrmReportsPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const db = getDb();
  const workspace = await getWorkspace(db, session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "crm:reports")) return <AccessState />;
  const initial = await getCrmReport(db, session.user.id, tenantId, "last30");
  return <ReportsView tenantId={tenantId} initial={initial} />;
}
