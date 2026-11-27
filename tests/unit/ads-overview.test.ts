import { describe, expect, it } from "vitest";
import { activeCampaigns, attentionItems, budgetShare, budgetWindows, emptyRuleDraft, healthRows, healthSummary, ruleFlags, rulePayload, spendBy, type RuleRun, type RuleView } from "../../src/lib/ads/overview";
import { flatten, type AdAccountView, type AdsAlert, type ResultsRow, type TreeCampaign } from "../../src/lib/ads/view";
import { ruleInput } from "../../src/lib/ads/ads";

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const account = (patch: Partial<AdAccountView> = {}): AdAccountView => ({ id: ACCOUNT, connectionId: "c", network: "meta", externalRef: "x", name: "Main", currency: "USD", timezone: "UTC", status: "active",
  health: { account_status: { state: "ok" }, payment_method: { state: "ok" } }, lastRefusal: null, healthCheckedAt: "2026-11-25T10:00:00Z", syncedAt: null, syncState: "ok", version: 1, ...patch });
const ad = (id: string, patch: Record<string, unknown> = {}) => ({ id, adSetId: "s1", campaignId: "c1", name: `Ad ${id}`, status: "active" as const, format: "image", reviewStatus: "approved", reviewReason: null, deliveryIssue: null, sourcePostRef: null, version: 1, ...patch });
const tree = (): TreeCampaign[] => [
  { id: "c1", adAccountId: ACCOUNT, name: "Daily campaign", goal: "traffic", status: "active", budgetAmount: 20, budgetType: "daily", budgetLevel: "campaign", startDate: "2026-11-01", endDate: null, bidding: null, specialAdCategories: [], version: 1,
    adSets: [{ id: "s1", name: "Set one", status: "active", budgetAmount: null, budgetType: null, startDate: null, endDate: null, bidding: null, targeting: {}, version: 1, ads: [ad("a1", { reviewStatus: "rejected", reviewReason: "Policy" }), ad("a2", { deliveryIssue: "budget_capped" }), ad("a3", { status: "archived", reviewStatus: "rejected" })] }] },
  { id: "c2", adAccountId: ACCOUNT, name: "Lifetime campaign", goal: "awareness", status: "active", budgetAmount: null, budgetType: null, budgetLevel: "adset", startDate: "2026-11-01", endDate: "2026-10-01", bidding: null, specialAdCategories: [], version: 1,
    adSets: [{ id: "s2", name: "Lifetime set", status: "active", budgetAmount: 100, budgetType: "lifetime", startDate: "2026-11-10", endDate: "2026-12-01", bidding: null, targeting: {}, version: 1, ads: [] }] },
  { id: "c3", adAccountId: ACCOUNT, name: "Off", goal: "traffic", status: "paused", budgetAmount: 5, budgetType: "daily", budgetLevel: "campaign", startDate: null, endDate: null, bidding: null, specialAdCategories: [], version: 1, adSets: [] },
];
const row = (entityId: string, day: string, metrics: ResultsRow["metrics"], level: ResultsRow["level"] = "campaign"): ResultsRow => ({ level, entityId, day, metrics });
const today = "2026-11-25";

describe("ads overview: budgets", () => {
  it("counts daily budgets on today and lifetime budgets from their start, only for active entities that own a budget", () => {
    const windows = budgetWindows(tree(), today);
    expect([...windows]).toEqual([["c1", today], ["s2", "2026-11-10"]]);
    const spent = spendBy([row("c1", today, { spend: 19 }), row("c1", "2026-11-24", { spend: 50 }), row("s2", "2026-11-12", { spend: 40 }, "adset"), row("s2", "2026-11-09", { spend: 99 }, "adset"), row("s2", today, { spend: 55 }, "adset"), row("c3", today, { spend: 5 })], (id) => windows.get(id) ?? null, today);
    expect(Object.fromEntries(spent)).toEqual({ c1: 19, s2: 95 });
  });
  it("never reads a budget as spent when nobody reported its spend, or when the budget sits on the ad sets", () => {
    const flat = flatten(tree());
    expect(budgetShare(flat.campaigns[0], undefined)).toBeNull();
    expect(budgetShare(flat.campaigns[1], 500)).toBeNull();
    expect(budgetShare(flat.campaigns[2], 5)).toBeNull();
    expect(budgetShare(flat.campaigns[0], 18)).toBeCloseTo(0.9);
  });
});

describe("ads overview: needs attention", () => {
  it("lists account problems, alerts, rejected ads, delivery issues, budgets nearly spent and rule flags, urgent first, without repeating an alert's ad", () => {
    const alerts: AdsAlert[] = [
      { id: "al1", adAccountId: ACCOUNT, kind: "delivery_issue", severity: "warning", subjectLevel: "ad", subjectId: "a2", state: "open", createdAt: "2026-11-25T00:00:00Z" },
      { id: "al2", adAccountId: "other", kind: "payment_problem", severity: "critical", subjectLevel: null, subjectId: null, state: "open", createdAt: "2026-11-25T00:00:00Z" },
    ];
    const items = attentionItems({ account: account({ health: { payment_method: { state: "failing", fixUrl: "https://example.test/fix" }, pixel: { state: "warning" } } }), alerts, campaigns: tree(),
      spent: new Map([["c1", 19], ["s2", 101]]), flags: [{ ruleId: "r1", ruleName: "Costly", level: "campaign", targetId: "c1", ranAt: "2026-11-25T01:00:00Z" }] });
    expect(items.map((i) => [i.kind, i.severity, i.subject?.id ?? null])).toEqual([
      ["healthCheck", "critical", null], ["adRejected", "critical", "a1"], ["budgetNearlySpent", "critical", "s2"],
      ["healthCheck", "warning", null], ["alert", "warning", "a2"], ["budgetNearlySpent", "warning", "c1"], ["ruleFlag", "warning", "c1"],
    ]);
    expect(items[0]).toMatchObject({ detail: "payment_method.failing", fixUrl: "https://example.test/fix" });
    expect(items.find((i) => i.kind === "alert")!.alertId).toBe("al1");
    // The archived rejected ad and the other account's alert are not listed.
    expect(items.some((i) => i.subject?.id === "a3" || i.alertId === "al2")).toBe(false);
  });
  it("shows a restricted account and a failing refresh once, not again as alerts", () => {
    const alerts: AdsAlert[] = [{ id: "x", adAccountId: ACCOUNT, kind: "account_restricted", severity: "critical", subjectLevel: null, subjectId: null, state: "open", createdAt: "" },
      { id: "y", adAccountId: ACCOUNT, kind: "sync_failed", severity: "warning", subjectLevel: null, subjectId: null, state: "open", createdAt: "" }];
    const items = attentionItems({ account: account({ status: "restricted", syncState: "failing" }), alerts, campaigns: [], spent: new Map(), flags: [] });
    expect(items.map((i) => i.kind)).toEqual(["accountStatus", "syncFailing"]);
  });
  it("is empty for a healthy account with nothing to flag", () => {
    expect(attentionItems({ account: account(), alerts: [], campaigns: [], spent: new Map(), flags: [] })).toEqual([]);
  });
  it("counts active campaigns that have not ended", () => {
    expect(activeCampaigns(tree(), today)).toBe(1);
  });
});

describe("ads overview: health", () => {
  it("lists every named check and reads a check nobody answered as unknown, never ok", () => {
    const rows = healthRows(account());
    expect(rows).toHaveLength(8);
    expect(rows.find((r) => r.name === "pixel")!.state).toBe("unknown");
    expect(healthSummary(account())).toBe("ok");
    expect(healthSummary(account({ healthCheckedAt: null }))).toBe("unknown");
    expect(healthSummary(account({ health: { pixel: { state: "warning" } } }))).toBe("warning");
    expect(healthSummary(account({ status: "disabled" }))).toBe("failing");
  });
});

describe("ads rules (flag only)", () => {
  const rule = (patch: Partial<RuleView> = {}): RuleView => ({ id: "r1", adAccountId: ACCOUNT, name: "Costly", level: "campaign", condition: { metric: "spend", operator: "gt", threshold: 5, windowDays: 3 }, action: "notify", enabled: true, version: 1, ...patch });
  it("always sends the flag action, which the server schema accepts, and never a pause", () => {
    const made = rulePayload({ ...emptyRuleDraft(), name: " Spend over 50 ", threshold: "50" }, ACCOUNT);
    expect(made).toMatchObject({ ok: true, body: { name: "Spend over 50", action: "notify", condition: { metric: "spend", operator: "gt", threshold: 50, windowDays: 3 } } });
    if (!made.ok) throw new Error("expected a payload");
    expect(() => ruleInput.parse(made.body)).not.toThrow();
    // Founder decision 26 Nov: the server schema refuses any action that changes delivery or spend.
    expect(() => ruleInput.parse({ ...made.body, action: "pause" })).toThrow();
    for (const metric of ["spend", "costPerResult", "ctr"] as const) {
      const other = rulePayload({ ...emptyRuleDraft(), name: "x", metric, threshold: "2" }, ACCOUNT);
      expect(other.ok && other.body.action).toBe("notify");
    }
  });
  it("stores click-through rate as a share and refuses an incomplete draft with its field", () => {
    const ctr = rulePayload({ ...emptyRuleDraft(), name: "Low CTR", metric: "ctr", operator: "lt", threshold: "1.5" }, ACCOUNT);
    expect(ctr.ok && ctr.body.condition.threshold).toBeCloseTo(0.015);
    expect(rulePayload({ ...emptyRuleDraft(), threshold: "5" }, ACCOUNT)).toEqual({ ok: false, field: "name" });
    expect(rulePayload({ ...emptyRuleDraft(), name: "x", threshold: "" }, ACCOUNT)).toEqual({ ok: false, field: "threshold" });
    expect(rulePayload({ ...emptyRuleDraft(), name: "x", threshold: "-1" }, ACCOUNT)).toEqual({ ok: false, field: "threshold" });
    expect(rulePayload({ ...emptyRuleDraft(), name: "x", threshold: "1", windowDays: "31" }, ACCOUNT)).toEqual({ ok: false, field: "windowDays" });
  });
  it("keeps the latest flag per rule and target inside the window", () => {
    const now = new Date("2026-11-25T12:00:00Z");
    const runs = new Map<string, RuleRun[]>([["r1", [
      { id: "1", targetLevel: "campaign", targetId: "c1", outcome: "triggered", detail: {}, ranAt: "2026-11-24T00:00:00Z" },
      { id: "2", targetLevel: "campaign", targetId: "c1", outcome: "triggered", detail: {}, ranAt: "2026-11-25T00:00:00Z" },
      { id: "3", targetLevel: "campaign", targetId: "c2", outcome: "failed", detail: {}, ranAt: "2026-11-25T00:00:00Z" },
      { id: "4", targetLevel: "campaign", targetId: "c3", outcome: "triggered", detail: {}, ranAt: "2026-11-01T00:00:00Z" },
    ]], ["gone", [{ id: "5", targetLevel: "campaign", targetId: "c1", outcome: "triggered", detail: {}, ranAt: "2026-11-25T00:00:00Z" }]]]);
    expect(ruleFlags([rule()], runs, now)).toEqual([{ ruleId: "r1", ruleName: "Costly", level: "campaign", targetId: "c1", ranAt: "2026-11-25T00:00:00Z" }]);
  });
});
