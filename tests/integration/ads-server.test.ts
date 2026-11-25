import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { linkConnection } from "../../src/server/social/service";
import { webhookSecrets } from "../../src/server/social/webhook-secrets";
import { signBody } from "../../src/server/social/webhook-signature";
import { withTenant } from "../../src/server/tenancy";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";
import { defaultAdsDeps, type AdsDeps } from "../../src/server/ads/registry";
import { adsResponse } from "../../src/server/ads/http";
import { checkAccountHealth, dismissAlert, linkAdAccounts, listAlerts, syncAdAccount, syncResults } from "../../src/server/ads/accounts";
import { cancelLaunchRequest, createLaunchRequest, launchRequest, reviewLaunchRequest, updateLaunchRequest, validateLaunchRequest } from "../../src/server/ads/launch";
import { bulkSetStatus, remove, rename, setBudget, setStatus } from "../../src/server/ads/mutations";
import { readResults, readTree } from "../../src/server/ads/read";
import { createLeadForm, deleteLead, eraseAdLeadsByIdentifier, listLeads, syncLeads, updateLeadStatus } from "../../src/server/ads/leads";
import { createRule, listRuleRuns, previewRule, runRules, setRuleEnabled } from "../../src/server/ads/rules";
import { receiveAdsWebhook } from "../../src/server/ads/webhook";
import { pruneAdsLeads, pruneAdsResults } from "../../src/server/ads/prune";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

vi.mock("server-only", () => ({}));
const ads = new FakeAdsProvider(CANARY);
const deps: AdsDeps = { enabled: true, provider: () => ads, now: () => new Date() };
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, conn: string, acct: string;
let network: ReturnType<typeof noNetwork>;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const key = () => randomUUID();
const day = (delta: number) => new Date(Date.now() + delta * 86_400_000).toISOString().slice(0, 10);
const campaignBody = (extra: Record<string, unknown> = {}) => ({ adAccountId: acct, name: "Easter outreach", goal: "traffic", budgetAmount: 20, targeting: { countries: ["US"] }, creative: { format: "image", mediaRefs: ["m1"], headline: "Join us" }, ...extra });
async function launched(extra: Record<string, unknown> = {}) {
  const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: campaignBody(extra) }, deps);
  const v = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  const r = await reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, deps);
  return (await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: key() }, deps)).request ?? r.request;
}
const tree = async () => (await readTree(f.db, p.owner, p.tenant, acct, deps)).campaigns;
async function webhook(event: Record<string, unknown>, opts: { signature?: string | null; deps?: AdsDeps; secret?: string } = {}) {
  const raw = JSON.stringify({ timestamp: new Date().toISOString(), accountRef: "act_1", ...event });
  const signature = opts.signature === undefined ? signBody(raw, opts.secret ?? webhookSecrets()[0]) : opts.signature;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-fake-signature"] = signature;
  return receiveAdsWebhook(f.db, new Request("http://localhost/api/integrations/ads/webhook/fake", { method: "POST", headers, body: raw }), "fake", opts.deps ?? deps);
}

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "ads");
  useTestKeys();
  network = noNetwork();
  const social = newFake(), sdeps = depsFor(social);
  conn = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, sdeps)).connection.id;
  const otherConn = (await linkConnection(f.db, p.outsider, p.other, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, sdeps)).connection.id;
  ads.addAccount("acc-fb-2", { ref: "act_1", name: "Grace ads" });
  ads.addAccount("acc-ig-1", { ref: "act_other", name: "Other ads" });
  acct = (await linkAdAccounts(f.db, p.owner, p.tenant, { connectionId: conn }, deps)).accounts[0].id;
  await linkAdAccounts(f.db, p.outsider, p.other, { connectionId: otherConn }, deps);
});
beforeEach(async () => {
  await q("truncate ads_audience_uploads, ads_conversion_sends, ads_results, ads_operations, ads_launch_requests, ads_leads, ads_lead_forms, ads_alerts, ads_rule_runs, ads_rules, ads_webhook_events, ads_audiences, ads_conversion_destinations, ads_ads, ads_ad_sets, ads_campaigns");
  ads.remotes.get("acc-fb-2\u0000act_1")!.campaigns.length = 0;
  ads.remotes.get("acc-fb-2\u0000act_1")!.results.length = 0;
  ads.remotes.get("acc-fb-2\u0000act_1")!.leads.length = 0;
  ads.remotes.get("acc-fb-2\u0000act_1")!.forms.length = 0;
  ads.calls.length = 0;
});
afterAll(async () => {
  if (network) expect(network).not.toHaveBeenCalled();
  network?.mockRestore();
  useKeyProvider(null);
  await f?.close();
});

it("enforces FORCE RLS, owner/admin only, neutral 404s and two-ministry isolation", async () => {
  const rls = await q("select relrowsecurity, relforcerowsecurity from pg_class where relkind='r' and relname like 'ads\\_%'");
  expect(rls.rows).toHaveLength(17);
  expect(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  for (const user of [p.admin, p.owner]) await expect(readTree(f.db, user, p.tenant, null, deps)).resolves.toBeTruthy();
  for (const user of [p.member, p.viewer, p.outsider]) await expect(readTree(f.db, user, p.tenant, null, deps)).rejects.toMatchObject({ status: 404 });
  await expect(checkAccountHealth(f.db, p.outsider, p.other, acct, deps)).rejects.toMatchObject({ status: 404 });
  await expect(createLaunchRequest(f.db, p.outsider, p.other, { kind: "campaign", payload: campaignBody() }, deps)).rejects.toMatchObject({ status: 404 });
  const mine = await withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => (await tx.execute(sql`select id from ads_accounts`)).rows);
  expect(mine).toHaveLength(1);
  // The app role holds no delete on provider-derived history, and cannot call the privileged prune function.
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`delete from ads_results`); })).rejects.toThrow();
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`select public.ads_results_prune(10)`); })).rejects.toThrow();
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`insert into ads_webhook_events(tenant_id,provider,provider_event_id,event_type,external_account_ref,body_hash,occurred_at) values (${p.tenant},'fake','x','t','a','h',now())`); })).rejects.toThrow();
});

it("is hard-off by default and the route answers one neutral 404", async () => {
  expect(defaultAdsDeps().enabled).toBe(false);
  await expect(readTree(f.db, p.owner, p.tenant, null, defaultAdsDeps())).rejects.toMatchObject({ status: 404 });
  const res = await adsResponse(new Request("http://localhost/x"), { params: Promise.resolve({ tenantId: p.tenant, path: ["tree"] }) }, defaultAdsDeps());
  expect(res.status).toBe(404);
  expect((await webhook({ id: "e", type: "lead.received" }, { deps: defaultAdsDeps() })).status).toBe(404);
});

it("reports health with every check, 'unknown' when unanswered, and alerts on a failing payment method", async () => {
  const r = ads.remotes.get("acc-fb-2\u0000act_1")!;
  const view = await checkAccountHealth(f.db, p.owner, p.tenant, acct, deps);
  expect(view.account.health.payment_method.state).toBe("ok");
  expect(view.account.health.pixel.state).toBe("unknown");
  expect(Object.keys(view.account.health).sort()).toEqual(["account_status", "instagram_link", "lead_ads_terms", "page_link", "payment_method", "pixel", "spend_limit", "whatsapp_link"]);
  r.health.checks.payment_method = { state: "failing", fixUrl: "https://example.test/fix" };
  r.health.lastRefusal = { code: "policy", fixUrl: "https://example.test/fix" };
  const bad = await checkAccountHealth(f.db, p.owner, p.tenant, acct, deps);
  expect(bad.account.lastRefusal).toMatchObject({ code: "policy" });
  const alerts = (await listAlerts(f.db, p.owner, p.tenant, deps)).alerts;
  expect(alerts.map(a => a.kind)).toContain("payment_problem");
  r.health.checks.payment_method = { state: "ok" }; r.health.lastRefusal = null;
  await checkAccountHealth(f.db, p.owner, p.tenant, acct, deps);
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind)).not.toContain("payment_problem");
  ads.fail("getAdAccountHealth", "AUTH");
  await expect(checkAccountHealth(f.db, p.owner, p.tenant, acct, deps)).rejects.toMatchObject({ status: 422 });
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind)).toContain("connection_lost");
});

it("gates launch behind validate, review and an exact-payload hash; launches once per key and never twice on an ambiguous retry", async () => {
  const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: campaignBody() }, deps);
  await expect(reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: request.version }, deps)).rejects.toMatchObject({ details: { code: "VALIDATION_REQUIRED" } });
  await expect(launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: key() }, deps)).rejects.toMatchObject({ details: { code: "NOT_REVIEWED" } });
  const v = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  expect(v.request.validation).toEqual({ ok: true, problems: [] });
  expect(ads.calls.filter(c => c.method === "launch")).toHaveLength(0);
  await expect(reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: 1 }, deps)).rejects.toMatchObject({ status: 409 });
  const reviewed = await reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, deps);
  expect(reviewed.request.status).toBe("reviewed");
  // Editing after review drops the review.
  const edited = await updateLaunchRequest(f.db, p.owner, p.tenant, request.id, { payload: campaignBody({ name: "Easter outreach 2" }), version: reviewed.request.version }, deps);
  expect(edited.request).toMatchObject({ status: "draft", validation: null });
  const v2 = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  const r2 = await reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v2.request.version }, deps);
  const k = key();
  ads.ambiguousOnce("launch");
  const first = await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: k }, deps);
  expect(first.request.status).toBe("ambiguous");
  await expect(launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: key() }, deps)).rejects.toMatchObject({ status: 409 });
  const second = await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: k }, deps);
  expect(second.request.status).toBe("launched");
  const replay = await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: k }, deps);
  expect(replay).toMatchObject({ replayed: true, request: { status: "launched" } });
  expect(ads.remotes.get("acc-fb-2\u0000act_1")!.campaigns).toHaveLength(1);
  const [c] = await tree();
  expect(c).toMatchObject({ name: "Easter outreach 2", status: "paused", goal: "traffic", budgetAmount: 20 });
  expect(c.adSets[0].ads).toHaveLength(1);
  const audits = await q("select action, metadata from audit_logs where tenant_id=$1 and action like 'ads.launch%' order by created_at", [p.tenant]);
  expect(audits.rows.map(r => r.action)).toEqual(expect.arrayContaining(["ads.launch_review", "ads.launch_requested", "ads.launch_outcome"]));
  expect(JSON.stringify(audits.rows)).not.toContain("Easter");
  void r2;
});

it("refuses political or issue ads at review and at launch, and keeps raw targeting owner-only", async () => {
  const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: campaignBody({ specialAdCategories: ["social_issues_elections_politics"] }) }, deps);
  const v = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  expect(v.request.validation).toMatchObject({ ok: false, problems: ["policy_refused"] });
  await expect(reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, deps)).rejects.toMatchObject({ details: { code: "POLICY_REFUSED" } });
  await expect(createLaunchRequest(f.db, p.admin, p.tenant, { kind: "campaign", payload: campaignBody({ rawTargeting: { x: 1 } }) }, deps)).rejects.toMatchObject({ status: 404 });
  await expect(createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: campaignBody({ rawTargeting: { x: 1 } }) }, deps)).resolves.toBeTruthy();
  await expect(createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload: campaignBody({ budgetAmount: -1 }) }, deps)).rejects.toMatchObject({ status: 422 });
  await cancelLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  expect(ads.calls.filter(c => c.method === "launch")).toHaveLength(0);
});

it("boosts a post into an existing ad set and adds an ad to one", async () => {
  const c = await launched();
  const [camp] = await tree();
  expect(c.status).toBe("launched");
  const setId = camp.adSets[0].id;
  const run = async (kind: string, payload: Record<string, unknown>) => {
    const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind, payload }, deps);
    const v = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
    await reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, deps);
    return (await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: key() }, deps)).request;
  };
  const boost = await run("boost", { adAccountId: acct, name: "Boost Sunday", postRef: "post-9", goal: "engagement", budgetAmount: 5, existingAdSetId: setId });
  const added = await run("add_ad", { adAccountId: acct, adSetId: setId, name: "Second creative", creative: { format: "text", headline: "h" } });
  expect([boost.status, added.status]).toEqual(["launched", "launched"]);
  const [after] = await tree();
  expect(after.adSets[0].ads.map(a => a.name).sort()).toEqual(["Boost Sunday", "Easter outreach", "Second creative"]);
  expect(after.adSets[0].ads.find(a => a.name === "Boost Sunday")!.sourcePostRef).toBe("post-9");
  const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind: "add_ad", payload: { adAccountId: acct, adSetId: randomUUID(), name: "x", creative: { format: "text" } } }, deps);
  await expect(validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps)).rejects.toMatchObject({ details: { code: "AD_SET_UNAVAILABLE" } });
});

it("pauses, resumes, renames, bulk-pauses and cancels with stale-version protection, idempotency and audit", async () => {
  await launched();
  const [camp] = await tree();
  const k = key();
  await expect(setStatus(f.db, p.owner, p.tenant, { level: "campaign", id: camp.id, status: "active", version: camp.version + 5, idempotencyKey: k }, deps)).rejects.toMatchObject({ status: 409 });
  await expect(setStatus(f.db, p.owner, p.tenant, { level: "campaign", id: camp.id, status: "paused", version: camp.version, idempotencyKey: k }, deps)).rejects.toMatchObject({ details: { code: "STATUS_NOT_ALLOWED" } });
  const res = await setStatus(f.db, p.owner, p.tenant, { level: "campaign", id: camp.id, status: "active", version: camp.version, idempotencyKey: k }, deps);
  expect(res).toMatchObject({ applied: true, replayed: false });
  expect((await setStatus(f.db, p.owner, p.tenant, { level: "campaign", id: camp.id, status: "active", version: camp.version, idempotencyKey: k }, deps)).replayed).toBe(true);
  expect(ads.calls.filter(c => c.method === "setStatus")).toHaveLength(1);
  await expect(setStatus(f.db, p.owner, p.tenant, { level: "adset", id: camp.adSets[0].id, status: "paused", version: camp.adSets[0].version, idempotencyKey: k }, deps)).rejects.toMatchObject({ details: { code: "KEY_MISMATCH" } });
  const [live] = await tree();
  expect(live.status).toBe("active");
  await rename(f.db, p.owner, p.tenant, { level: "ad", id: live.adSets[0].ads[0].id, name: "Renamed", version: live.adSets[0].ads[0].version }, deps, key());
  const ambiguousKey = key();
  ads.ambiguousOnce("setStatus");
  await expect(setStatus(f.db, p.owner, p.tenant, { level: "adset", id: live.adSets[0].id, status: "active", version: live.adSets[0].version, idempotencyKey: ambiguousKey }, deps)).rejects.toMatchObject({ details: { code: "OUTCOME_UNKNOWN_RETRY_SAME_KEY" } });
  expect((await q("select status from ads_operations where idempotency_key=$1", [ambiguousKey])).rows[0].status).toBe("ambiguous");
  await setStatus(f.db, p.owner, p.tenant, { level: "adset", id: live.adSets[0].id, status: "active", version: live.adSets[0].version, idempotencyKey: ambiguousKey }, deps);
  const now = (await tree())[0];
  await bulkSetStatus(f.db, p.owner, p.tenant, { status: "paused", idempotencyKey: key(), items: [{ level: "campaign", id: now.id, version: now.version }] }, deps);
  await expect(bulkSetStatus(f.db, p.owner, p.tenant, { status: "paused", idempotencyKey: key(), items: [] }, deps)).rejects.toMatchObject({ status: 422 });
  const after = (await tree())[0];
  await expect(remove(f.db, p.owner, p.tenant, { level: "campaign", id: after.id, version: after.version, idempotencyKey: key() }, deps)).rejects.toMatchObject({ status: 422 });
  const gone = await remove(f.db, p.owner, p.tenant, { level: "campaign", id: after.id, version: after.version, idempotencyKey: key(), confirmIrreversible: true }, deps);
  expect(gone.applied).toBe(true);
  expect((await tree())[0].status).toBe("archived");
  await expect(setStatus(f.db, p.owner, p.tenant, { level: "campaign", id: after.id, status: "active", version: (await tree())[0].version, idempotencyKey: key() }, deps)).rejects.toMatchObject({ details: { code: "STATUS_NOT_ALLOWED" } });
  const audits = (await q("select action from audit_logs where tenant_id=$1 and action like 'ads.%'", [p.tenant])).rows.map(r => r.action);
  expect(audits).toEqual(expect.arrayContaining(["ads.status_outcome", "ads.rename_outcome", "ads.bulk_status_outcome", "ads.delete_outcome"]));
});

it("changes budgets only with confirmation, the current version and a level that owns the budget", async () => {
  await launched();
  const [camp] = await tree();
  const base = { level: "campaign", id: camp.id, version: camp.version, idempotencyKey: key() };
  await expect(setBudget(f.db, p.owner, p.tenant, { ...base, budgetAmount: 50 }, deps)).rejects.toMatchObject({ status: 422 });
  await expect(setBudget(f.db, p.owner, p.tenant, { ...base, confirm: true, budgetAmount: 50, version: camp.version + 1 }, deps)).rejects.toMatchObject({ status: 409 });
  await setBudget(f.db, p.owner, p.tenant, { ...base, confirm: true, budgetAmount: 50, bidding: { costType: "cost_cap", unitCost: 2.5 } }, deps);
  const [changed] = await tree();
  expect(changed).toMatchObject({ budgetAmount: 50, bidding: { costType: "cost_cap", unitCost: 2.5 }, version: camp.version + 1 });
  await expect(setBudget(f.db, p.owner, p.tenant, { level: "adset", id: changed.adSets[0].id, version: changed.adSets[0].version, idempotencyKey: key(), confirm: true, budgetAmount: 5 }, deps)).rejects.toMatchObject({ details: { code: "BUDGET_LEVEL" } });
  const audits = await q("select metadata from audit_logs where action='ads.budget_outcome' and tenant_id=$1", [p.tenant]);
  expect(audits.rows).toHaveLength(1);
});

it("syncs results with newest-value-per-day semantics, recomputed ratios and unavailable-not-zero", async () => {
  await launched();
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  const ref = remote.campaigns[0].ref, d = day(-1);
  remote.results.push({ level: "campaign", ref, day: d, metrics: { spend: 10, impressions: 1000, clicks: 40, results: 4 } });
  const t0 = new Date(Date.now() - 60_000), t1 = new Date();
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-3), to: day(0) }, deps, t0);
  remote.results[0].metrics = { spend: 12, impressions: 1200, clicks: 60, results: 6 };
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-3), to: day(0) }, deps, t1);
  // An older capture arriving late never replaces the newer one.
  remote.results[0].metrics = { spend: 1, impressions: 1 };
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-3), to: day(0) }, deps, new Date(Date.now() - 3_600_000));
  const [camp] = await tree();
  const out = await readResults(f.db, p.owner, p.tenant, { adAccountId: acct, level: "campaign", from: day(-3), to: day(0), entityId: camp.id }, deps);
  expect(out.rows).toHaveLength(1);
  expect(out.rows[0].metrics).toMatchObject({ spend: 12, impressions: 1200, clicks: 60, results: 6 });
  expect(out.rows[0].metrics.ctr).toBeCloseTo(0.05); expect(out.rows[0].metrics.costPerResult).toBeCloseTo(2);
  expect(out.totals.spend).toEqual({ value: 12, availability: "available" });
  expect(out.totals.reach).toEqual({ value: null, availability: "unavailable" });
  expect(out.totals.conversions).toEqual({ value: null, availability: "unavailable" });
  const none = await readResults(f.db, p.owner, p.tenant, { adAccountId: acct, level: "ad", from: day(-3), to: day(0) }, deps);
  expect(none.rows).toEqual([]); expect(none.totals.spend.availability).toBe("unavailable");
  await expect(readResults(f.db, p.owner, p.tenant, { adAccountId: acct, level: "campaign", from: day(0), to: day(-400) }, deps)).rejects.toMatchObject({ status: 422 });
  await expect(syncResults(f.db, p.owner, p.tenant, acct, { from: day(-200), to: day(0) }, deps)).rejects.toMatchObject({ status: 422 });
  await q("update ads_results set day = day - 500");
  expect(await pruneAdsResults(f.workerPool)).toBeGreaterThan(0);
});

it("raises spend-without-results and review/delivery alerts from synced data", async () => {
  await launched();
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  remote.campaigns[0].adSets[0].ads[0].review = "rejected"; remote.campaigns[0].adSets[0].ads[0].reviewReason = "policy text";
  remote.campaigns[0].adSets[0].ads[0].deliveryIssue = "budget_capped";
  remote.results.push({ level: "campaign", ref: remote.campaigns[0].ref, day: day(0), metrics: { spend: 9, results: 0 } });
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-1), to: day(0) }, deps);
  const kinds = (await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind).sort();
  expect(kinds).toEqual(["ad_rejected", "budget_capped", "spend_without_results"]);
  const [c] = await tree();
  expect(c.adSets[0].ads[0]).toMatchObject({ reviewStatus: "rejected", reviewReason: "policy text", deliveryIssue: "budget_capped" });
  const alert = (await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.find(a => a.kind === "budget_capped")!;
  await dismissAlert(f.db, p.owner, p.tenant, alert.id, deps);
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts).toHaveLength(2);
  remote.campaigns[0].adSets[0].ads[0].review = "approved"; remote.campaigns[0].adSets[0].ads[0].deliveryIssue = null;
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind)).toEqual(["spend_without_results"]);
});

it("creates lead forms, ingests leads as ad-lead records with consent evidence, and creates no CRM contact", async () => {
  const contactsBefore = (await q("select count(*)::int as n from contacts")).rows[0].n;
  const k = key();
  const { form } = await createLeadForm(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Visit form", consentText: "We may contact you about visiting.", privacyUrl: "https://example.test/privacy", questions: ["full_name", "email"] }, k, deps);
  const again = await createLeadForm(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Visit form", consentText: "We may contact you about visiting.", privacyUrl: "https://example.test/privacy", questions: ["full_name", "email"] }, k, deps);
  expect(again.form.id).toBe(form.id);
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  const formRef = remote.forms[0].ref;
  remote.leads.push({ ref: "lead-1", network: "meta", formRef, campaignRef: "c1", adRef: "a1", fields: { email: "visitor@example.test", full_name: "V" }, submittedAt: new Date() });
  expect((await syncLeads(f.db, p.owner, p.tenant, acct, deps)).added).toBe(1);
  expect((await syncLeads(f.db, p.owner, p.tenant, acct, deps)).added).toBe(0);
  const wh = await webhook({ id: "evt-lead-2", type: "lead.received", subjectRef: "lead-2", data: { formId: formRef, adId: "a1", fields: { email: "two@example.test" } } });
  expect(wh.status).toBe(202);
  expect((await webhook({ id: "evt-lead-2", type: "lead.received", subjectRef: "lead-2", data: { formId: formRef, fields: { email: "two@example.test" } } })).status).toBe(202);
  const { leads } = await listLeads(f.db, p.owner, p.tenant, {}, deps);
  expect(leads).toHaveLength(2);
  expect(leads.every(l => l.status === "new" && l.consentText === "We may contact you about visiting." && l.crmContactCreated === false)).toBe(true);
  expect((await q("select count(*)::int as n from contacts")).rows[0].n).toBe(contactsBefore);
  const lead = leads[0];
  const updated = await updateLeadStatus(f.db, p.owner, p.tenant, lead.id, { status: "contacted", version: lead.version }, deps);
  expect(updated.lead.status).toBe("contacted");
  await expect(updateLeadStatus(f.db, p.owner, p.tenant, lead.id, { status: "qualified", version: lead.version }, deps)).rejects.toMatchObject({ status: 409 });
  await expect(updateLeadStatus(f.db, p.owner, p.tenant, lead.id, { status: "bogus", version: 2 }, deps)).rejects.toMatchObject({ status: 422 });
  expect((await listLeads(f.db, p.owner, p.tenant, { status: "contacted" }, deps)).leads).toHaveLength(1);
  await expect(listLeads(f.db, p.outsider, p.other, { adAccountId: acct }, deps)).resolves.toEqual({ leads: [] });
  await deleteLead(f.db, p.owner, p.tenant, lead.id, deps);
  expect((await listLeads(f.db, p.owner, p.tenant, {}, deps)).leads).toHaveLength(1);
});

it("keeps rules disabled by default, previews without acting, pauses through the audited path and logs each run", async () => {
  await launched();
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  remote.campaigns[0].status = "active";
  remote.results.push({ level: "campaign", ref: remote.campaigns[0].ref, day: day(0), metrics: { spend: 30, impressions: 900, clicks: 30, results: 3 } });
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-1), to: day(0) }, deps);
  const { rule } = await createRule(f.db, p.owner, p.tenant, { adAccountId: acct, name: "Pause costly", level: "campaign", condition: { metric: "costPerResult", operator: "gt", threshold: 5 }, action: "pause" }, deps);
  expect(rule.enabled).toBe(false);
  const preview = await previewRule(f.db, p.owner, p.tenant, rule.id, deps);
  expect(preview.wouldAct).toHaveLength(1);
  expect(await runRules(f.db, p.owner, p.tenant, acct, deps)).toMatchObject({ ran: 0, triggered: 0 });
  expect((await tree())[0].status).toBe("active");
  await setRuleEnabled(f.db, p.owner, p.tenant, rule.id, { enabled: true, version: rule.version }, deps);
  await expect(setRuleEnabled(f.db, p.owner, p.tenant, rule.id, { enabled: false, version: rule.version }, deps)).rejects.toMatchObject({ status: 409 });
  const ran = await runRules(f.db, p.owner, p.tenant, acct, deps);
  if (ran.failed) console.log(JSON.stringify((await q("select detail from ads_rule_runs")).rows));
  expect(ran).toMatchObject({ ran: 1, triggered: 1, failed: 0 });
  expect((await tree())[0].status).toBe("paused");
  expect((await listRuleRuns(f.db, p.owner, p.tenant, rule.id, deps)).runs).toHaveLength(1);
  expect(await runRules(f.db, p.owner, p.tenant, acct, deps)).toMatchObject({ triggered: 0 });
  expect((await q("select count(*)::int as n from audit_logs where action in ('ads.rule_create','ads.rule_enable','ads.rules_run','ads.status_outcome') and tenant_id=$1", [p.tenant])).rows[0].n).toBeGreaterThanOrEqual(4);
});

it("verifies signatures, applies events idempotently from fixtures and ignores unknown accounts", async () => {
  await launched();
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  const campRef = remote.campaigns[0].ref, adRef = remote.campaigns[0].adSets[0].ads[0].ref;
  expect((await webhook({ id: "e1", type: "ad.updated", subjectRef: adRef, data: { status: "active" } }, { signature: "0".repeat(64) })).status).toBe(404);
  expect((await webhook({ id: "e1", type: "ad.updated", subjectRef: adRef, data: { status: "active" } }, { signature: null })).status).toBe(404);
  expect((await webhook({ id: "e1", type: "ad.updated", subjectRef: adRef, data: { status: "active" } }, { secret: "wrong" })).status).toBe(404);
  expect((await q("select count(*)::int as n from ads_webhook_events")).rows[0].n).toBe(0);
  expect((await webhook({ id: "e2", type: "ad.review_updated", subjectRef: adRef, data: { review: "rejected", reason: "text" } })).status).toBe(202);
  expect((await webhook({ id: "e2", type: "ad.review_updated", subjectRef: adRef, data: { review: "approved" } })).status).toBe(202);
  expect((await tree())[0].adSets[0].ads[0].reviewStatus).toBe("rejected");
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind)).toContain("ad_rejected");
  await webhook({ id: "e3", type: "ad.review_updated", subjectRef: adRef, data: { review: "approved" } });
  expect((await listAlerts(f.db, p.owner, p.tenant, deps)).alerts.map(a => a.kind)).not.toContain("ad_rejected");
  await webhook({ id: "e4", type: "campaign.updated", subjectRef: campRef, data: { status: "active" } });
  expect((await tree())[0].status).toBe("active");
  await webhook({ id: "e5", type: "ad_account.status_changed", data: { status: "restricted" } });
  expect((await q("select status from ads_accounts where id=$1", [acct])).rows[0].status).toBe("restricted");
  await webhook({ id: "e6", type: "account.ads.sync_failed" });
  expect((await q("select sync_state from ads_accounts where id=$1", [acct])).rows[0].sync_state).toBe("failing");
  await webhook({ id: "e7", type: "ad.delivery_issue", subjectRef: adRef, data: { issue: "limited" } });
  await webhook({ id: "e8", type: "ad_rule.run", data: {} });
  expect((await webhook({ id: "e9", type: "ad.updated", subjectRef: adRef, data: { status: "paused" }, accountRef: "no-such-account" })).status).toBe(202);
  expect((await q("select count(*)::int as n from ads_webhook_events where provider_event_id='e9'")).rows[0].n).toBe(0);
  expect((await webhook({ id: "bad", type: "ad.updated", timestamp: "2020-01-01T00:00:00Z", subjectRef: adRef, data: { status: "paused" } })).status).toBe(202);
  expect((await q("select count(*)::int as n from ads_webhook_events where provider_event_id='bad'")).rows[0].n).toBe(0);
});

it("never sends conversion events and never touches the network", async () => {
  await expect(ads.sendConversionEvents({ secret: CANARY }, { accountRef: "acc-fb-2", adAccountRef: "act_1", destinationRef: "px", idempotencyKey: randomUUID(), events: [{ name: "Lead", at: new Date(), eventId: "e", userData: {} }] })).rejects.toMatchObject({ code: "DISABLED" });
  expect(ads.refusedConversionSends.length).toBeGreaterThan(0);
  expect(network).not.toHaveBeenCalled();
});

it("covers audiences, shared budgets, targeting search, boostable posts and identities as read paths", async () => {
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  remote.audiences.push({ ref: "aud-1", kind: "lookalike", name: "Lookalike 1%", sizeEstimate: 100000, spec: { source: "x" } });
  remote.destinations.push({ ref: "px-1", kind: "pixel", name: "Main pixel", lastEventAt: new Date(), status: "active" });
  remote.posts.push({ ref: "post-1", platform: "instagram", caption: "hello", publishedAt: new Date() });
  remote.sharedBudgets.push({ ref: "sb", name: "Shared", amount: 40 });
  remote.identities.push({ ref: "id-1", name: "Church", sparkCodeSupported: true });
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  const { listAudiences, listConversionDestinations } = await import("../../src/server/ads/accounts");
  const { listBoostablePosts, listIdentities, listSharedBudgets, searchTargeting } = await import("../../src/server/ads/mutations");
  expect((await listAudiences(f.db, p.owner, p.tenant, acct, deps)).audiences).toMatchObject([{ kind: "lookalike", name: "Lookalike 1%" }]);
  expect((await listConversionDestinations(f.db, p.owner, p.tenant, acct, deps)).destinations).toHaveLength(1);
  expect((await listBoostablePosts(f.db, p.owner, p.tenant, acct, deps)).posts).toHaveLength(1);
  expect((await listIdentities(f.db, p.owner, p.tenant, acct, deps)).identities[0].sparkCodeSupported).toBe(true);
  expect((await listSharedBudgets(f.db, p.owner, p.tenant, acct, deps)).sharedBudgets).toHaveLength(1);
  expect((await searchTargeting(f.db, p.owner, p.tenant, acct, { kind: "interest", query: "choir" }, deps)).hits).toHaveLength(2);
  await expect(searchTargeting(f.db, p.owner, p.tenant, acct, { kind: "nope", query: "x" }, deps)).rejects.toMatchObject({ status: 422 });
});

it("keeps ad leads for 90 days only and erases them by email or phone for an owner or admin", async () => {
  const insert = (ref: string, fields: Record<string, string>, age = "0 days", tenant = p.tenant, account = acct) => q(`insert into ads_leads(tenant_id,ad_account_id,network,lead_ref,fields,created_at) values($1,$2,'meta',$3,$4, now() - $5::interval)`, [tenant, account, ref, fields, age]);
  await insert("l-old", { email: "old@example.test" }, "91 days");
  await insert("l-new", { email: "new@example.test" }, "89 days");
  expect(await pruneAdsLeads(f.workerPool, 10)).toBe(1);
  expect((await q("select lead_ref from ads_leads order by lead_ref")).rows.map(r => r.lead_ref)).toEqual(["l-new"]);
  await expect(withTenant(f.db, p.owner, p.tenant, "ads:manage", async tx => { await tx.execute(sql`select public.ads_leads_prune(10)`); })).rejects.toThrow();
  await insert("l-mail", { email: "Person@Example.test", full_name: "P" });
  await insert("l-phone", { phone: "+1 (555) 123-4567" });
  const otherAccount = (await q("select id from ads_accounts where tenant_id=$1", [p.other])).rows[0].id;
  await insert("l-other", { email: "person@example.test" }, "0 days", p.other, otherAccount);
  await expect(eraseAdLeadsByIdentifier(f.db, p.member, p.tenant, "person@example.test", deps)).rejects.toMatchObject({ status: 404 });
  expect(await eraseAdLeadsByIdentifier(f.db, p.admin, p.tenant, " person@example.test ", deps)).toEqual({ erased: 1 });
  expect(await eraseAdLeadsByIdentifier(f.db, p.owner, p.tenant, "15551234567", deps)).toEqual({ erased: 1 });
  expect(await eraseAdLeadsByIdentifier(f.db, p.owner, p.tenant, "nobody@example.test", deps)).toEqual({ erased: 0 });
  await expect(eraseAdLeadsByIdentifier(f.db, p.owner, p.tenant, "ab", deps)).rejects.toMatchObject({ status: 422 });
  // Another ministry's lead with the same email is untouched, and the audit holds a count only.
  expect((await q("select count(*)::int n from ads_leads where lead_ref='l-other'")).rows[0].n).toBe(1);
  const audits = await q("select metadata from audit_logs where action='ads.leads_erase' and tenant_id=$1", [p.tenant]);
  expect(JSON.stringify(audits.rows)).not.toMatch(/example\.test|1555/);
  expect((await q("select count(*)::int n from ads_leads where lead_ref in ('l-mail','l-phone')")).rows[0].n).toBe(0);
});

it("takes a lead's network from the ad account, not from the event", async () => {
  await q("update ads_accounts set network='google' where id=$1", [acct]);
  await webhook({ id: "net-1", type: "lead.received", subjectRef: "lead-net", data: { fields: { email: "n@example.test" } } });
  expect((await q("select network from ads_leads where lead_ref='lead-net'")).rows[0].network).toBe("google");
  await q("update ads_accounts set network='meta' where id=$1", [acct]);
});
