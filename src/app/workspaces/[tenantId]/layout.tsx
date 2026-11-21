import { cookies } from "next/headers";
import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace, listWorkspaces } from "@/server/workspaces";
import { AccessError, can } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AppShell } from "@/components/app-shell";
import { communitiesEnabled } from "@/server/communities-mode";
import { eventsEnabled } from "@/server/events";
import { socialScreensEnabled } from "@/server/social-publish-gate";
import { shellModesEnabled } from "@/server/shell-modes";
import { shellSettings } from "@/server/shell-settings";
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string }> }) {
  const session = await pageSession(), { tenantId } = await params;
  const defaultOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const workspaces = await listWorkspaces(getDb(), session.user.id);
  const plain = await shellSettings(getDb(), session.user.id);
  if (!uuidInput.safeParse(tenantId).success) return <AppShell defaultOpen={defaultOpen} workspaces={workspaces} email={session.user.email} settings={plain}>{children}</AppShell>;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AppShell defaultOpen={defaultOpen} workspaces={workspaces} email={session.user.email} settings={plain}>{children}</AppShell>;
  const settings = can(workspace.role, "social:connect") ? await shellSettings(getDb(), session.user.id, { socialStaff: true }) : plain;
  return <AppShell defaultOpen={defaultOpen} workspaces={workspaces} selected={tenantId} email={session.user.email} brandTheme={workspace.brandTheme} features={[...(communitiesEnabled() ? ["communities" as const] : []), ...(eventsEnabled() ? ["events" as const] : []), ...(socialScreensEnabled() ? ["social" as const] : [])]} modeSwitcher={shellModesEnabled()} settings={settings}>{children}</AppShell>;
}
