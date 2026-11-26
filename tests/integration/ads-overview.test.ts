import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { linkConnection } from "../../src/server/social/service";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";
import type { AdsDeps } from "../../src/server/ads/registry";
import { adsResponse } from "../../src/server/ads/http";
import { linkAdAccounts, syncAdAccount, syncResults } from "../../src/server/ads/accounts";
import { createLaunchRequest, launchRequest, reviewLaunchRequest, validateLaunchRequest } from "../../src/server/ads/launch";
import { readResults, readTree } from "../../src/server/ads/read";
import { createRule, deleteRule, listRuleRuns, listRules, previewRule, runRules, setRuleEnabled } from "../../src/server/ads/rules";
import { rulePayload, emptyRuleDraft } from "../../src/lib/ads/overview";
import { testDatabase } from "../database";
import { CANARY, depsFor, newFake, noNetwork, seedPeople, useTestKeys } from "./social-layer-fixture";

// Ads overview and flag-only rules: the reads the overview uses and a rule made the way the Rules screen makes it. A flag rule records a run and changes nothing on the ad account.
vi.mock("server-only", () => ({}));
const ads = new FakeAdsProvider(CANARY);
const deps: AdsDeps = { enabled: true, provider: () => ads, now: () => new Date() };
let f: Awaited<ReturnType<typeof testDatabase>>, p: Awaited<ReturnType<typeof seedPeople>>, acct: string;
let network: ReturnType<typeof noNetwork>;
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const day = (delta: number) => new Date(Date.now() + delta * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "adsov");
  useTestKeys();
  network = noNetwork();
  const social = newFake(), sdeps = depsFor(social);
  const conn = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-fb-2" }, sdeps)).connection.id;
  ads.addAccount("acc-fb-2", { ref: "act_1", name: "Grace ads" });
  acct = (await linkAdAccounts(f.db, p.owner, p.tenant, { connectionId: conn }, deps)).accounts[0].id;
  const payload = { adAccountId: acct, name: "Easter outreach", goal: "traffic", budgetAmount: 20, status: "active", targeting: { countries: ["US"] }, creative: { format: "image", mediaRefs: ["m1"], headline: "Join us" } };
  const { request } = await createLaunchRequest(f.db, p.owner, p.tenant, { kind: "campaign", payload }, deps);
  const v = await validateLaunchRequest(f.db, p.owner, p.tenant, request.id, deps);
  await reviewLaunchRequest(f.db, p.owner, p.tenant, request.id, { version: v.request.version }, deps);
  await launchRequest(f.db, p.owner, p.tenant, request.id, { idempotencyKey: randomUUID() }, deps);
  const remote = ads.remotes.get("acc-fb-2\u0000act_1")!;
  remote.campaigns[0].status = "active";
  remote.results.push({ level: "campaign", ref: remote.campaigns[0].ref, day: day(0), metrics: { spend: 19, impressions: 900, clicks: 30, results: 2 } },
    { level: "campaign", ref: remote.campaigns[0].ref, day: day(-30), metrics: { spend: 7, impressions: 300, clicks: 3 } });
  await syncAdAccount(f.db, p.owner, p.tenant, acct, deps);
  await syncResults(f.db, p.owner, p.tenant, acct, { from: day(-40), to: day(0) }, deps);
});
afterAll(async () => {
  if (network) expect(network).not.toHaveBeenCalled();
  network?.mockRestore();
  useKeyProvider(null);
  await f?.close();
});

it("reads the range and the period before it separately, and never turns an unreported measure into zero", async () => {
  const now = await readResults(f.db, p.owner, p.tenant, { adAccountId: acct, level: "campaign", from: day(-27), to: day(0) }, deps);
  const before = await readResults(f.db, p.owner, p.tenant, { adAccountId: acct, level: "campaign", from: day(-55), to: day(-28) }, deps);
  expect(now.rows).toHaveLength(1);
  expect(now.totals.spend).toEqual({ value: 19, availability: "available" });
  expect(before.rows).toHaveLength(1);
  // The earlier day reported no results: cost per result over it is unavailable, not zero.
  expect(before.totals.results).toEqual({ value: null, availability: "unavailable" });
  expect(before.totals.costPerResult).toEqual({ value: null, availability: "unavailable" });
});

it("flags what matches without changing its status or calling any change on the ad account, and logs each check", async () => {
  const made = rulePayload({ ...emptyRuleDraft(), name: "Spend over 10", threshold: "10", windowDays: "1" }, acct);
  if (!made.ok) throw new Error("payload");
  const { rule } = await createRule(f.db, p.owner, p.tenant, made.body, deps);
  expect(rule).toMatchObject({ enabled: false, action: "notify" });
  expect((await previewRule(f.db, p.owner, p.tenant, rule.id, deps)).wouldAct).toHaveLength(1);
  await setRuleEnabled(f.db, p.owner, p.tenant, rule.id, { enabled: true, version: rule.version }, deps);
  const before = (await readTree(f.db, p.owner, p.tenant, acct, deps)).campaigns[0];
  ads.calls.length = 0;
  expect(await runRules(f.db, p.owner, p.tenant, acct, deps)).toMatchObject({ ran: 1, triggered: 1, failed: 0 });
  expect(ads.calls.map((c) => c.method)).toEqual([]);
  const campaign = (await readTree(f.db, p.owner, p.tenant, acct, deps)).campaigns[0];
  expect(campaign.status).toBe("active");
  expect(campaign.version).toBe(before.version);
  const runs = (await listRuleRuns(f.db, p.owner, p.tenant, rule.id, deps)).runs;
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({ outcome: "triggered", targetId: campaign.id, detail: { action: "notify" } });
  expect((await q("select count(*)::int as n from audit_logs where action like 'ads.status%' and tenant_id=$1", [p.tenant])).rows[0].n).toBe(0);
  await deleteRule(f.db, p.owner, p.tenant, rule.id, deps);
  expect((await listRules(f.db, p.owner, p.tenant, deps)).rules).toEqual([]);
});

it("answers the overview and rules routes with a neutral 404 to a member", async () => {
  const response = await adsResponse(new Request(`http://localhost/api/workspaces/${p.tenant}/social/ads/rules`), { params: Promise.resolve({ tenantId: p.tenant, path: ["rules"] }) }, { ...deps });
  // No session cookie: the route refuses before any read.
  expect(response.status).toBeGreaterThanOrEqual(400);
  await expect(listRules(f.db, p.member, p.tenant, deps)).rejects.toMatchObject({ status: 404 });
  await expect(readResults(f.db, p.member, p.tenant, { adAccountId: acct, level: "campaign", from: day(-1), to: day(0) }, deps)).rejects.toMatchObject({ status: 404 });
});
