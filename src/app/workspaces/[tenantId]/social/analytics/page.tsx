import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AnalyticsDashboard } from "@/components/social/analytics/analytics-dashboard";

type Props = { params: Promise<{ tenantId: string }> };

// Social Analytics screen. 404 before any session work while the non-production gate is closed; owner and admin only; the numbers come from the
// read-only Analytics routes (stored snapshots), and nothing on this screen can start a refresh.
export default async function SocialAnalyticsPage({ params }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "social:analytics")) return <AccessState />;
  return <AnalyticsDashboard tenantId={tenantId} />;
}
