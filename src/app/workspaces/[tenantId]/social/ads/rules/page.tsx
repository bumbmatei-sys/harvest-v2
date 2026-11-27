import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AdsRules } from "@/components/ads/ads-rules";

type Props = { params: Promise<{ tenantId: string }> };

// Ads rules (flag only). 404 before any session work while the non-production gate is closed; owner and admin only (`ads:manage`); every number and action goes through the Ads routes.
export default async function AdsRulesPage({ params }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "ads:manage")) return <AccessState />;
  return <AdsRules tenantId={tenantId} />;
}
