import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace } from "@/server/workspaces";
import { requireSocialScreens } from "@/server/social-publish-gate";
import { SOCIAL_HUMAN_REPLY_ENABLED } from "@/server/social/inbox-reply";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AccessState } from "@/components/access-state";
import { Inbox } from "@/components/social/inbox/inbox";

type Props = { params: Promise<{ tenantId: string }>; searchParams: Promise<{ view?: string }> };

// Social Inbox screen. 404 before any session work while the non-production gate is closed; owner and admin only (neutral answer for everyone else);
// the data comes from the Inbox routes. Sending replies is a hard-off constant: the screen reads it here and never decides it.
export default async function InboxPage({ params, searchParams }: Props) {
  requireSocialScreens();
  const session = await pageSession(), { tenantId } = await params;
  if (!uuidInput.safeParse(tenantId).success) return <AccessState />;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace || !can(workspace.role, "social:inbox")) return <AccessState />;
  return <Inbox tenantId={tenantId} me={session.user.id} sendEnabled={SOCIAL_HUMAN_REPLY_ENABLED} view={(await searchParams).view === "settings" ? "settings" : "inbox"} />;
}
