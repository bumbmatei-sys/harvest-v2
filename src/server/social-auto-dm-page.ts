import "server-only";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";

/**
 * The shared guard of the Auto-DM pages: 404 before any session or database work while the non-production gate is closed, then owner or admin only.
 * Returns null for everything else, which the pages render as the same neutral access state (a missing ministry and a missing role look alike).
 */
export async function autoDmPageContext(params: Promise<{ tenantId: string }>) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return null;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "social:auto_dm")) return null;
  return { tenantId, you: { id: session.user.id, name: session.user.name || session.user.email } };
}
