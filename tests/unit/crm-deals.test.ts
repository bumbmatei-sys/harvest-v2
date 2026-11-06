import { describe, expect, it } from "vitest";
import { crmToday, dealInput, dealMove, dealPatch, dealQueryParams, defaultStages, isStale, parseDealQuery, stageInput, stageKey, weightedValue } from "../../src/lib/crm-deals";
import { can } from "../../src/server/permissions";

describe("CRM-04 shared model", () => {
  it("weights only open deals with both an amount and a probability", () => {
    expect(weightedValue("1000", "open", 25)).toBe(250);
    expect(weightedValue("999.99", "open", 33)).toBe(330);
    expect(weightedValue(null, "open", 50)).toBe(0);
    expect(weightedValue("1000", "open", null)).toBe(0);
    expect(weightedValue("1000", "won", 100)).toBe(0);
    expect(weightedValue("1000", "lost", 0)).toBe(0);
  });
  it("flags stale deals only when open and past their expected close date", () => {
    expect(isStale("open", "2026-01-01", "2026-01-02")).toBe(true);
    expect(isStale("open", "2026-01-02", "2026-01-02")).toBe(false);
    expect(isStale("open", null, "2026-01-02")).toBe(false);
    expect(isStale("won", "2026-01-01", "2026-01-02")).toBe(false);
  });
  it("computes today in Europe/Berlin, not UTC", () => {
    expect(crmToday(new Date("2026-03-31T22:30:00Z"))).toBe("2026-04-01");
    expect(crmToday(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });
  it("validates deals: a relation, decimal amounts, one currency, and a reason only as text", () => {
    expect(dealInput.safeParse({ name: "x" }).success).toBe(false);
    expect(dealInput.parse({ name: " Fair ", companyId: "00000000-0000-4000-8000-000000000001", amount: "12.5", expectedCloseDate: "" }))
      .toMatchObject({ name: "Fair", amount: "12.5", currency: "USD", expectedCloseDate: null });
    for (const amount of ["-1", "1.234", "1e3", "abc", "1000000000000"]) expect(dealInput.safeParse({ name: "x", contactId: "00000000-0000-4000-8000-000000000001", amount }).success).toBe(false);
    expect(dealInput.safeParse({ name: "x", contactId: "00000000-0000-4000-8000-000000000001", currency: "EUR" }).success).toBe(false);
    expect(dealPatch.parse({ closedReason: "  ", amount: "", version: 1 })).toEqual({ closedReason: null, amount: null, version: 1 });
    expect(dealMove.safeParse({ stageId: "not-a-uuid", version: 1 }).success).toBe(false);
  });
  it("validates stages and derives stable keys", () => {
    expect(stageKey("Visit planned!")).toBe("visit_planned");
    expect(stageKey("1st call")).toBe("stage_1st_call");
    expect(stageInput.safeParse({ name: "x", probability: 101 }).success).toBe(false);
    expect(stageInput.safeParse({ name: "x", color: "#ff0000" }).success).toBe(false);
    expect(stageInput.parse({ name: "x" })).toMatchObject({ kind: "open", probability: null, color: "neutral" });
    expect(defaultStages.filter((stage) => stage.kind !== "open").map((stage) => stage.key)).toEqual(["won", "lost"]);
  });
  it("parses board and list URL state and drops defaults when writing it back", () => {
    const parsed = parseDealQuery({ mode: "list", sort: "-amount", stale: "1", page: "2", unrelated: "x" });
    expect(parsed.success && parsed.data).toMatchObject({ mode: "list", sort: "-amount", stale: "1", page: 2 });
    expect(parsed.success && dealQueryParams(parsed.data).toString()).toBe("mode=list&stale=1&sort=-amount&page=2");
    for (const raw of [{ sort: "drop" }, { mode: "grid" }, { min: "-1" }, { stage: "x" }]) expect(parseDealQuery(raw).success).toBe(false);
  });
  it("gives readers deals, writers deal edits, and only owners and admins pipeline settings", () => {
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "opportunities:read"))).toEqual([true, true, true, true]);
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "opportunities:write"))).toEqual([true, true, true, false]);
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "crm:pipelines_write"))).toEqual([true, true, false, false]);
    expect(can("unknown", "opportunities:read")).toBe(false);
  });
});
