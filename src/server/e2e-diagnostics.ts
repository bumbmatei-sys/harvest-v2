/**
 * Diagnostics for the browser-test server only: a 403 says which check refused it. Both conditions are required, so a stray HARVEST_E2E_MOCK_EMAIL on a live deploy exposes nothing
 * (production, Vercel production and Harvest production are all excluded).
 */
export function e2eDiagnosticsOn(env: Record<string, string | undefined> = process.env) {
  return env.HARVEST_E2E_MOCK_EMAIL === "1" && env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production" && env.HARVEST_ENV !== "production";
}
export const e2eReason = (reason: string, env: Record<string, string | undefined> = process.env) => e2eDiagnosticsOn(env) ? { reason } : undefined;
/** Table, routine and message of a refused statement (no values), or undefined outside the browser-test server. */
export function e2eDenialDetails(pg: { table?: string; routine?: string; message?: string }, env: Record<string, string | undefined> = process.env) {
  return e2eDiagnosticsOn(env) ? { sqlstate: "42501", table: String(pg.table ?? ""), routine: String(pg.routine ?? ""), pg: String(pg.message ?? "").slice(0, 200) } : undefined;
}
