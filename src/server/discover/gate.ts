import "server-only";
import { communitiesEnabled } from "../communities-mode";
import { defaultDiscoverDeps, type DiscoverDeps } from "./registry";

/** Non-production gate, the same switch as the other Public mode screens. DISCOVER_SERVER_ENABLED stays the literal `false`; nothing here opens in production. */
export function discoverGateOpen(env: Record<string, string | undefined> = process.env) {
  return env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && communitiesEnabled(env);
}
export const discoverRouteDeps = (env: Record<string, string | undefined> = process.env): DiscoverDeps => discoverGateOpen(env) ? { enabled: true, now: () => new Date() } : defaultDiscoverDeps();
