import type { SmokeConfig } from "./smoke-config";
import { json, smokeGet } from "./smoke-http";

export type SmokeWorkspace = { tenantId: string; name: string };
export type SignedInConfig = SmokeConfig & { sessionCookie: NonNullable<SmokeConfig["sessionCookie"]>; email: string; workspaceName: string };
export function signedInConfig(config: SmokeConfig): SignedInConfig | null {
  return config.sessionCookie && config.email && config.workspaceName ? config as SignedInConfig : null;
}

/**
 * Proves the cookie belongs to the dedicated smoke account and that the account
 * can see exactly one workspace, the smoke church. Every signed-in check calls
 * this first, so a real person's session is refused before any page is opened.
 */
export async function verifiedSmokeWorkspace(config: SignedInConfig): Promise<SmokeWorkspace> {
  const session = await smokeGet(config, "/api/auth/get-session", { signedIn: true });
  if (session.status !== 200) throw new Error(`Reading the smoke session failed (status ${session.status}).`);
  const body = json(session, "/api/auth/get-session") as { user?: { email?: string } } | null;
  if (!body?.user) throw new Error("The smoke sign-in has expired or was signed out. Sign in again as the smoke account and update HARVEST_SMOKE_SESSION_TOKEN.");
  if (body.user.email?.toLowerCase() !== config.email) throw new Error("Refusing to continue: the session does not belong to HARVEST_SMOKE_EMAIL.");
  const list = await smokeGet(config, "/api/workspaces", { signedIn: true });
  if (list.status !== 200) throw new Error(`Listing the smoke account's workspaces failed (status ${list.status}).`);
  const workspaces = json(list, "/api/workspaces") as SmokeWorkspace[];
  if (!Array.isArray(workspaces) || workspaces.length !== 1 || workspaces[0].name !== config.workspaceName) {
    throw new Error("Refusing to continue: the smoke account must belong to exactly one workspace, named as HARVEST_SMOKE_WORKSPACE.");
  }
  return { tenantId: workspaces[0].tenantId, name: workspaces[0].name };
}
