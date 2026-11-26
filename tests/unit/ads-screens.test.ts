import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adsKitApprovals } from "../../src/lib/ui-provenance";
import messages from "../../messages/en.json";
import { aggregate, appliesTo, bulkItems, columnIds, columnsFor, columnPresets, daily, daysBetween, deliveryOf, flatten, pruneSelection, totalsFor, visibleRows, type Entity, type ResultsRow, type TreeCampaign } from "../../src/lib/ads/view";

const set = (id: string, ads: string[]) => ({ id, name: `Set ${id}`, status: "active" as const, budgetAmount: 10, budgetType: "daily" as const, startDate: null, endDate: null, bidding: null, targeting: {}, version: 1,
  ads: ads.map((a) => ({ id: a, adSetId: id, campaignId: "", name: `Ad ${a}`, status: "paused" as const, format: "image", reviewStatus: "approved", reviewReason: null, deliveryIssue: null, sourcePostRef: null, version: 1 })) });
const tree: TreeCampaign[] = [
  { id: "c1", adAccountId: "x", name: "One", goal: "traffic", status: "active", budgetAmount: 20, budgetType: "daily", budgetLevel: "campaign", startDate: null, endDate: null, bidding: null, specialAdCategories: [], version: 1, adSets: [set("s1", ["a1", "a2"]), set("s2", ["a3"])] },
  { id: "c2", adAccountId: "x", name: "Two", goal: "awareness", status: "paused", budgetAmount: null, budgetType: null, budgetLevel: "adset", startDate: null, endDate: "2026-01-01", bidding: { costType: "cost_cap", unitCost: 3 }, specialAdCategories: [], version: 2, adSets: [set("s3", ["a4"])] },
];
const flat = flatten(tree);
const row = (patch: Partial<Entity>): Entity => ({ ...flat.ads[0], ...patch });
const result = (entityId: string, day: string, metrics: ResultsRow["metrics"]): ResultsRow => ({ level: "campaign", entityId, day, metrics });

describe("ads table model", () => {
  it("flattens the tree into three levels with their parents", () => {
    expect(flat.campaigns.map((r) => r.id)).toEqual(["c1", "c2"]);
    expect(flat.adSets.map((r) => [r.id, r.campaignId, r.parentName])).toEqual([["s1", "c1", "One"], ["s2", "c1", "One"], ["s3", "c2", "Two"]]);
    expect(flat.ads.map((r) => [r.id, r.adSetId, r.campaignId])).toEqual([["a1", "s1", "c1"], ["a2", "s1", "c1"], ["a3", "s2", "c1"], ["a4", "s3", "c2"]]);
  });
  it("filters the next level by what is selected on the one above", () => {
    expect(visibleRows(flat, "adsets", { campaigns: [], adsets: [] })).toHaveLength(3);
    expect(visibleRows(flat, "adsets", { campaigns: ["c1"], adsets: [] }).map((r) => r.id)).toEqual(["s1", "s2"]);
    expect(visibleRows(flat, "ads", { campaigns: ["c1"], adsets: [] }).map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
    expect(visibleRows(flat, "ads", { campaigns: ["c1"], adsets: ["s2"] }).map((r) => r.id)).toEqual(["a3"]);
  });
  it("drops a selection that no longer exists or no longer belongs to the selected campaigns", () => {
    expect(pruneSelection(flat, { campaigns: ["gone", "c2"], adsets: ["s1", "s3"] })).toEqual({ campaigns: ["c2"], adsets: ["s3"] });
  });
  it("never turns a metric nobody reported into zero", () => {
    const sums = aggregate([result("c1", "2026-11-01", { spend: 10, impressions: 1000, clicks: 20 }), result("c1", "2026-11-02", { spend: 5, impressions: 500, clicks: 10, results: 3, reach: 300 }), result("c2", "2026-11-01", { spend: 4 })]);
    expect(sums.get("c1")!.metrics).toMatchObject({ spend: 15, impressions: 1500, clicks: 30, results: 3, costPerResult: 5, reach: 300 });
    expect(sums.get("c2")!.metrics.results).toBeUndefined();
    expect(sums.get("c2")!.metrics.costPerResult).toBeUndefined();
    expect(totalsFor([result("c2", "2026-11-01", { spend: 4 })], new Set(["c2"])).results).toBeUndefined();
  });
  it("shows reach as an average per day, never a sum across days", () => {
    const rows = [result("c1", "2026-11-01", { reach: 100 }), result("c1", "2026-11-02", { reach: 300 }), result("c2", "2026-11-01", { reach: 100 })];
    expect(aggregate(rows).get("c1")!.metrics.reach).toBe(200);
    expect(totalsFor(rows, new Set(["c1", "c2"])).reach).toBe(250);
  });
  it("leaves a gap, not a zero, for a day without data in a sparkline", () => {
    const points = daily([result("c1", "2026-11-02", { spend: 7 })], new Set(["c1"]), "spend", daysBetween("2026-11-01", "2026-11-03"));
    expect(points.map((p) => p.value)).toEqual([null, 7, null]);
  });
  it("reads delivery from the review result, a delivery issue and the end date before the switch", () => {
    const today = "2026-11-25";
    expect(deliveryOf(row({ reviewStatus: "rejected" }), today)).toBe("rejected");
    expect(deliveryOf(row({ reviewStatus: "in_review" }), today)).toBe("inReview");
    expect(deliveryOf(row({ deliveryIssue: "budget_capped" }), today)).toBe("issue");
    expect(deliveryOf(row({ level: "campaign", status: "active", endDate: "2026-11-01" }), today)).toBe("completed");
    expect(deliveryOf(row({ level: "campaign", status: "active", endDate: null }), today)).toBe("active");
    expect(deliveryOf(row({ level: "campaign", status: "paused" }), today)).toBe("off");
    expect(deliveryOf(row({ status: "archived" }), today)).toBe("archived");
  });
  it("offers each level only the columns that make sense and sends bulk changes for switchable rows only", () => {
    expect(appliesTo("budget", "ad")).toBe(false); expect(appliesTo("budget", "adset")).toBe(true); expect(appliesTo("review", "campaign")).toBe(false); expect(appliesTo("review", "ad")).toBe(true);
    expect(columnsFor("performance", [])).toEqual(columnPresets.performance);
    expect(columnsFor("custom", [])).toEqual(columnPresets.performance);
    expect(columnsFor("custom", ["spend"])).toEqual(["spend"]);
    for (const id of Object.values(columnPresets).flat()) expect(columnIds).toContain(id);
    expect(bulkItems([row({ status: "archived" }), row({ id: "z", status: "paused", version: 4 })])).toEqual([{ level: "ad", id: "z", version: 4 }]);
  });
});

describe("ads screens copy", () => {
  const dir = join(__dirname, "../../src/components/ads");
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts")).map((f) => join(dir, f));
  const lookup = (path: string) => path.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), messages);
  it("has every message key the Ads components use", () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const spaces = [...source.matchAll(/(\w+)\s*=\s*useTranslations\("([^"]+)"\)/g)].map((m) => [m[1], m[2]] as const);
      for (const [name, space] of spaces) {
        for (const m of source.matchAll(new RegExp(`\\b${name}\\(\\s*"([^"$]+)"`, "g"))) if (lookup(`${space}.${m[1]}`) === undefined) missing.push(`${file}: ${space}.${m[1]}`);
        for (const m of source.matchAll(new RegExp(`\\b${name}\\(\\s*\`([^\`$]*)\\$\\{`, "g"))) { const prefix = m[1].replace(/\.$/, ""); if (prefix && lookup(`${space}.${prefix}`) === undefined) missing.push(`${file}: ${space}.${prefix}.*`); }
      }
    }
    expect(missing).toEqual([]);
  });
  it("names no vendor and no Meta brand in the copy", () => {
    expect(JSON.stringify((messages as Record<string, unknown>).Ads)).not.toMatch(/zernio|facebook ads|ads manager|business suite/i);
  });
});

describe("ads kit approvals", () => {
  it("records the founder approval and lists only files that exist, carry the modelled-on header and copy nothing", () => {
    expect(adsKitApprovals).toMatchObject({ approvedBy: "founder", approvedOn: "2026-11-25", copied: false });
    for (const file of adsKitApprovals.files) {
      const head = readFileSync(join(__dirname, "../..", file), "utf8").split("\n")[0];
      expect(head, file).toMatch(/^\/\*\* Layout and behaviour modelled on Shadcn UI Kit items? .+approved by the founder 25 Nov 2026; code written for Harvest, no kit code copied\./);
      expect(head, file).not.toMatch(/Derived from/);
    }
  });
});

import { createSteps, emptyDraft, fromPayload, goalsFor, problems, stepGroup, stepsFor, toPayload, type Draft } from "../../src/lib/ads/create";
import { launchPayload } from "../../src/lib/ads/ads";
describe("ads create model", () => {
  const good = (patch: Partial<Draft> = {}): Draft => ({ ...emptyDraft("campaign", "11111111-1111-4111-8111-111111111111"), name: "Easter", goal: "traffic", budgetAmount: "20", format: "text", body: "Join us", linkUrl: "https://example.test/easter", ...patch });
  it("turns a complete draft into a payload the server's own schema accepts, and refuses an incomplete one with the field and step", () => {
    expect(problems(good())).toEqual([]);
    expect(() => launchPayload("campaign", toPayload(good()))).not.toThrow();
    expect(problems(good({ name: "" })).map((p) => [p.field, p.step])).toEqual([["name", "create"]]);
    expect(problems(good({ goal: "" })).some((p) => p.field === "goal" && p.step === "objective")).toBe(true);
    expect(problems(good({ budgetAmount: "" })).map((p) => [p.field, p.step])).toEqual([["budgetAmount", "budget"]]);
    expect(problems(good({ format: "image" })).map((p) => [p.field, p.step])).toEqual([["creative.mediaRefs", "ad"]]);
    expect(problems(good({ budgetType: "lifetime" })).map((p) => [p.field, p.step])).toEqual([["endDate", "schedule"]]);
    expect(problems(good({ goal: "lead_generation" })).map((p) => p.field)).toEqual(["creative.leadFormId"]);
  });
  it("sends no placements for automatic and the chosen ones for manual", () => {
    expect(toPayload(good())).not.toHaveProperty("placements");
    expect(toPayload(good({ placementsMode: "manual", placements: ["feed", "reels"] }))).toMatchObject({ placements: ["feed", "reels"] });
    expect(() => launchPayload("campaign", toPayload(good({ placementsMode: "manual", placements: ["feed"] })))).not.toThrow();
  });
  it("keeps a campaign that starts paused unless asked, and flags the refused category on the budget step", () => {
    expect(toPayload(good()).status).toBe("paused");
    expect(problems(good({ categories: ["social_issues_elections_politics"] })).map((p) => [p.field, p.step])).toEqual([["specialAdCategories", "budget"]]);
  });
  it("boosting needs a post and has no ad step", () => {
    const boost = emptyDraft("boost", "11111111-1111-4111-8111-111111111111");
    expect(stepsFor("boost")).toEqual(["create", "objective", "budget", "audience", "placements", "schedule", "publish"]);
    expect(problems({ ...boost, name: "Boost", goal: "engagement", budgetAmount: "10" }).map((p) => p.field)).toEqual(["postRef"]);
    expect(() => launchPayload("boost", toPayload({ ...boost, name: "Boost", goal: "engagement", budgetAmount: "10", postRef: "p1" }))).not.toThrow();
  });
  it("round-trips a saved payload back into the form", () => {
    const original = good({ countries: ["US", "CA"], ageMin: "21", gender: "female", placementsMode: "manual", placements: ["feed"], interests: [{ id: "i1", name: "Music" }], status: "active", cta: "sign_up" });
    expect(fromPayload("campaign", toPayload(original))).toMatchObject({ name: "Easter", goal: "traffic", budgetAmount: "20", countries: ["US", "CA"], ageMin: "21", gender: "female", placements: ["feed"], interests: [{ id: "i1", name: "Music" }], status: "active", cta: "sign_up", format: "text" });
  });
  it("has nine steps in three groups, and a flow uses only the steps that apply", () => {
    expect(createSteps).toEqual(["create", "objective", "budget", "adset", "audience", "placements", "schedule", "ad", "publish"]);
    expect(createSteps.map((id) => stepGroup[id])).toEqual(["campaign", "campaign", "campaign", "adset", "adset", "adset", "adset", "ad", "ad"]);
    expect(stepsFor("campaign")).toEqual(createSteps);
    expect(stepsFor("add_ad")).toEqual(["create", "ad", "publish"]);
  });
  it("offers the objectives the server supports, and a boost has no messages goal", () => {
    expect(goalsFor("campaign")).toEqual(["awareness", "traffic", "engagement", "video_views", "lead_generation", "messages", "conversions", "app_promotion"]);
    expect(goalsFor("boost")).not.toContain("messages");
  });
  it("adds an ad to an existing ad set with the server's add-ad payload", () => {
    const d = good({ mode: "add_ad", existingAdSetId: "22222222-2222-4222-8222-222222222222", goal: "" });
    expect(toPayload(d)).toMatchObject({ adSetId: "22222222-2222-4222-8222-222222222222", name: "Easter", status: "paused" });
    expect(problems(d)).toEqual([]);
    expect(() => launchPayload("add_ad", toPayload(d))).not.toThrow();
    expect(problems({ ...d, existingAdSetId: "" }).map((p) => [p.field, p.step])).toEqual([["existingAdSetId", "create"]]);
    expect(problems({ ...d, name: "" }).map((p) => [p.field, p.step])).toEqual([["name", "ad"]]);
  });
  it("sends the ad set name and a bid limit", () => {
    expect(toPayload(good({ adSetName: "Families" }))).toMatchObject({ adSetName: "Families" });
    expect(toPayload(good())).not.toHaveProperty("bidding");
    const capped = good({ bidStrategy: "cost_cap", bidAmount: "4" });
    expect(toPayload(capped)).toMatchObject({ bidding: { costType: "cost_cap", unitCost: 4 } });
    expect(() => launchPayload("campaign", toPayload(capped))).not.toThrow();
    expect(fromPayload("campaign", toPayload(capped))).toMatchObject({ bidStrategy: "cost_cap", bidAmount: "4" });
  });
});
