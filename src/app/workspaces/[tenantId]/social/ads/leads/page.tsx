import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AdsLeads } from "@/components/ads/ads-leads";

type Props = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ tab?: string }> };

// Ads lead forms and leads. Same gate as the Ads manager: 404 while the non-production gate is closed, owner and admin only.
export default async function AdsLeadsPage({ params, searchParams }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params, query = await searchParams;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "ads:manage")) return <AccessState />;
  return <AdsLeads tenantId={tenantId} initialTab={query.tab === "leads" ? "leads" : "forms"} />;
}
