import { expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import type { SmokeConfig } from "./smoke-config";

export type SmokeWorkspace = { tenantId: string; name: string };
type SignedInConfig = SmokeConfig & { sessionCookie: NonNullable<SmokeConfig["sessionCookie"]>; email: string; workspaceName: string };
export function signedInConfig(config: SmokeConfig): SignedInConfig | null {
  return config.sessionCookie && config.email && config.workspaceName ? config as SignedInConfig : null;
}

/** An API client that sends the smoke session cookie and nothing that writes. */
export async function signedInRequest(config: SignedInConfig) {
  return playwrightRequest.newContext({ baseURL: config.baseURL, extraHTTPHeaders: {
    ...(config.bypassSecret ? { "x-vercel-protection-bypass": config.bypassSecret } : {}),
    cookie: `${config.sessionCookie.name}=${config.sessionCookie.value}`,
  } });
}

/**
 * Proves the cookie belongs to the dedicated smoke account and that the account
 * can see exactly one workspace, the smoke church. Every signed-in check calls
 * this first, so a real person's session is refused before any page is opened.
 */
export async function verifiedSmokeWorkspace(api: APIRequestContext, config: SignedInConfig): Promise<SmokeWorkspace> {
  const session = await api.get("/api/auth/get-session");
  expect(session.status(), "Reading the smoke session failed").toBe(200);
  const body = await session.json().catch(() => null) as { user?: { email?: string } } | null;
  if (!body?.user) throw new Error("The smoke sign-in has expired or was signed out. Sign in again as the smoke account and update HARVEST_SMOKE_SESSION_TOKEN.");
  if (body.user.email?.toLowerCase() !== config.email) throw new Error("Refusing to continue: the session does not belong to HARVEST_SMOKE_EMAIL.");
  const list = await api.get("/api/workspaces");
  expect(list.status(), "Listing the smoke account's workspaces failed").toBe(200);
  const workspaces = await list.json() as SmokeWorkspace[];
  if (workspaces.length !== 1 || workspaces[0].name !== config.workspaceName) {
    throw new Error("Refusing to continue: the smoke account must belong to exactly one workspace, named as HARVEST_SMOKE_WORKSPACE.");
  }
  return { tenantId: workspaces[0].tenantId, name: workspaces[0].name };
}
