import { getDb, type Database } from "../../db/client";
import { errorResponse, verifiedUser, verifyOrigin } from "../http";
import { readBoundedJson } from "../request-json";
import { AdsValidationError, invalid, unavailable } from "./access";
import * as accounts from "./accounts";
import * as launch from "./launch";
import * as leads from "./leads";
import * as audiences from "./crm-audiences";
import * as conversions from "./conversions";
import * as mutations from "./mutations";
import * as read from "./read";
import * as rules from "./rules";
import { adsRouteDeps } from "./gate";
import { assertAdsEnabled, type AdsDeps } from "./registry";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type Ctx = { db: Database; user: string; ws: string; deps: AdsDeps; url: URL; body: () => Promise<Record<string, unknown>>; };
type Handler = (c: Ctx, p: string[]) => Promise<object>;
const q = (c: Ctx, name: string) => c.url.searchParams.get(name) ?? undefined;
const need = (v: string | undefined) => { if (!v) throw invalid("ADS_INVALID_INPUT"); return v; };
const key = (c: Ctx, b: Record<string, unknown>) => String(b.idempotencyKey ?? "");

// Method + path pattern ("*" is one segment).
const routes: Record<string, Handler> = {
  "GET accounts": c => accounts.listAdAccounts(c.db, c.user, c.ws, c.deps),
  "POST accounts/link": async c => accounts.linkAdAccounts(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST accounts/*/health": (c, p) => accounts.checkAccountHealth(c.db, c.user, c.ws, p[1], c.deps),
  "POST accounts/*/sync": (c, p) => accounts.syncAdAccount(c.db, c.user, c.ws, p[1], c.deps),
  "POST accounts/*/results-sync": async (c, p) => accounts.syncResults(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "POST accounts/*/leads-sync": (c, p) => leads.syncLeads(c.db, c.user, c.ws, p[1], c.deps),
  "POST accounts/*/rules-run": (c, p) => rules.runRules(c.db, c.user, c.ws, p[1], c.deps),
  "GET tree": c => read.readTree(c.db, c.user, c.ws, q(c, "adAccountId") ?? null, c.deps),
  "GET results": c => read.readResults(c.db, c.user, c.ws, Object.fromEntries(c.url.searchParams), c.deps),
  "GET alerts": c => accounts.listAlerts(c.db, c.user, c.ws, c.deps, (q(c, "state") as "open") ?? "open"),
  "POST alerts/*/dismiss": (c, p) => accounts.dismissAlert(c.db, c.user, c.ws, p[1], c.deps),
  "GET audiences": c => accounts.listAudiences(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "GET conversions": c => accounts.listConversionDestinations(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "GET lead-forms": c => leads.listLeadForms(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "POST lead-forms": async c => { const b = await c.body(); return leads.createLeadForm(c.db, c.user, c.ws, { ...b, idempotencyKey: undefined }, key(c, b), c.deps); },
  "GET leads": c => leads.listLeads(c.db, c.user, c.ws, { adAccountId: q(c, "adAccountId"), status: q(c, "status") }, c.deps),
  "PATCH leads/*": async (c, p) => leads.updateLeadStatus(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "DELETE leads/*": (c, p) => leads.deleteLead(c.db, c.user, c.ws, p[1], c.deps),
  "POST leads/*/convert": (c, p) => leads.convertLeadToContact(c.db, c.user, c.ws, p[1], c.deps),
  "POST accounts/*/leads-convert": (c, p) => leads.convertNewLeads(c.db, c.user, c.ws, p[1], c.deps),
  "GET crm-audience/preview": c => audiences.previewAudienceUpload(c.db, c.user, c.ws, c.deps),
  "POST crm-audience": async c => audiences.createCustomerAudience(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST crm-audience/upload": async c => audiences.uploadCrmAudience(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST conversions/send": async c => conversions.sendConversionEvents(c.db, c.user, c.ws, await c.body(), c.deps),
  "GET launch-requests": c => launch.listLaunchRequests(c.db, c.user, c.ws, c.deps),
  "POST launch-requests": async c => launch.createLaunchRequest(c.db, c.user, c.ws, await c.body(), c.deps),
  "GET launch-requests/*": (c, p) => launch.getLaunchRequest(c.db, c.user, c.ws, p[1], c.deps),
  "PATCH launch-requests/*": async (c, p) => launch.updateLaunchRequest(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "POST launch-requests/*/validate": (c, p) => launch.validateLaunchRequest(c.db, c.user, c.ws, p[1], c.deps),
  "POST launch-requests/*/review": async (c, p) => launch.reviewLaunchRequest(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "POST launch-requests/*/launch": async (c, p) => launch.launchRequest(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "POST launch-requests/*/cancel": (c, p) => launch.cancelLaunchRequest(c.db, c.user, c.ws, p[1], c.deps),
  "GET boostable-posts": c => mutations.listBoostablePosts(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "GET identities": c => mutations.listIdentities(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "GET shared-budgets": c => mutations.listSharedBudgets(c.db, c.user, c.ws, need(q(c, "adAccountId")), c.deps),
  "POST targeting-search": async c => { const b = await c.body(); const { adAccountId, ...rest } = b; return mutations.searchTargeting(c.db, c.user, c.ws, String(adAccountId), rest, c.deps); },
  "POST status": async c => mutations.setStatus(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST status/bulk": async c => mutations.bulkSetStatus(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST rename": async c => { const b = await c.body(); const { idempotencyKey, ...rest } = b; return mutations.rename(c.db, c.user, c.ws, rest, c.deps, String(idempotencyKey ?? "")); },
  "POST budget": async c => mutations.setBudget(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST delete": async c => mutations.remove(c.db, c.user, c.ws, await c.body(), c.deps),
  "GET rules": c => rules.listRules(c.db, c.user, c.ws, c.deps),
  "POST rules": async c => rules.createRule(c.db, c.user, c.ws, await c.body(), c.deps),
  "POST rules/*/enabled": async (c, p) => rules.setRuleEnabled(c.db, c.user, c.ws, p[1], await c.body(), c.deps),
  "GET rules/*/runs": (c, p) => rules.listRuleRuns(c.db, c.user, c.ws, p[1], c.deps),
  "GET rules/*/preview": (c, p) => rules.previewRule(c.db, c.user, c.ws, p[1], c.deps),
  "DELETE rules/*": (c, p) => rules.deleteRule(c.db, c.user, c.ws, p[1], c.deps),
};
export const adsRouteTable = Object.keys(routes);

function match(method: string, path: string[]) {
  for (const [pattern, handler] of Object.entries(routes)) {
    const [m, p] = pattern.split(" "), parts = p.split("/");
    if (m === method && parts.length === path.length && parts.every((s, i) => s === "*" || s === path[i])) return handler;
  }
  return null;
}

export async function adsResponse(request: Request, context: { params: Promise<{ tenantId: string; path: string[] }> }, deps: AdsDeps = adsRouteDeps()) {
  try {
    assertAdsEnabled(deps);
    const method = request.method.toUpperCase();
    const { tenantId, path } = await context.params;
    const handler = match(method, path);
    if (!handler) throw unavailable();
    if (method !== "GET") verifyOrigin(request);
    const user = await verifiedUser(request);
    const body = async () => {
      const value = await readBoundedJson(request, 65_536, () => invalid("ADS_REQUEST_TOO_LARGE"));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("ADS_INVALID_INPUT");
      return value as Record<string, unknown>;
    };
    const result = await handler({ db: getDb(), user, ws: tenantId, deps, url: new URL(request.url), body }, path);
    return Response.json(result, { status: method === "POST" && path.length === 1 && ["launch-requests", "rules", "lead-forms"].includes(path[0]) ? 201 : 200, headers });
  } catch (error) {
    const response = error instanceof AdsValidationError ? Response.json({ error: error.message, details: error.details }, { status: error.status }) : errorResponse(error);
    Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  }
}
