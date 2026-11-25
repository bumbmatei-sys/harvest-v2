import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AdFormBuilder } from "@/components/ads/ad-form-builder";

type Props = { params: Promise<{ tenantId: string; formId: string }> };

// The lead form builder. Same gate as the Ads manager: 404 while the non-production gate is closed, owner and admin only.
export default async function AdFormPage({ params }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId, formId } = await params;
  if (!uuidInput.safeParse(tenantId).success || !uuidInput.safeParse(formId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "ads:manage")) return <AccessState />;
  return <AdFormBuilder tenantId={tenantId} formId={formId} />;
}
