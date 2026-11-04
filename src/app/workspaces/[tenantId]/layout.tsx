import { getDb } from "@/db/client";
import { pageSession } from "@/server/page-session";
import { getWorkspace, listWorkspaces } from "@/server/workspaces";
import { AccessError } from "@/server/permissions";
import { uuidInput } from "@/lib/contact-input";
import { AppShell } from "@/components/app-shell";
import { AccessState } from "@/components/access-state";
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenantId: string }> }) {
  const session = await pageSession(), { tenantId } = await params;
  const workspaces = await listWorkspaces(getDb(), session.user.id);
  if (!uuidInput.safeParse(tenantId).success) return <AppShell workspaces={workspaces} email={session.user.email}><AccessState /></AppShell>;
  const workspace = await getWorkspace(getDb(), session.user.id, tenantId).catch((error: unknown) => { if (error instanceof AccessError) return null; throw error; });
  if (!workspace) return <AppShell workspaces={workspaces} email={session.user.email}><AccessState /></AppShell>;
  return <AppShell workspaces={workspaces} selected={tenantId} email={session.user.email} brandTheme={workspace.brandTheme}>{children}</AppShell>;
}
