import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens, SOCIAL_TEST_CREDENTIAL } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { AccountsBoard } from "@/components/social/accounts-board";

type Props = { params: Promise<{ tenantId: string }> };

// Social Publish screen. 404 before any session work while the non-production gate is closed; owner and admin only; the data comes from the Publish routes.
export default async function AccountsPage({ params }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "social:connect")) return <AccessState />;
  return <AccountsBoard tenantId={tenantId} testConnect testCredential={SOCIAL_TEST_CREDENTIAL} />;
}
