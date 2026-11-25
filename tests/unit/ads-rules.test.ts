import { describe, expect, it } from "vitest";
import { addAdInput, boostInput, budgetInput, canMove, createCampaignInput, creativeSchema, deriveRatios, evaluateRule, isRefusedCategory, launchPayload, projectResults, reading, targetingSchema } from "../../src/lib/ads/ads";
import { parseAdsEvent } from "../../src/server/ads/webhook-parse";
import { ADS_INTEGRATION_ENABLED, defaultAdsDeps } from "../../src/server/ads/registry";
import { ZERNIO_ADS_LIVE_NETWORK, ZernioAdsAdapter } from "../../src/server/ads/zernio-ads-adapter";
import { FakeAdsProvider } from "../../src/server/ads/fake-provider";

const id = "11111111-1111-4111-8111-111111111111";
const campaign = { adAccountId: id, name: "Easter", goal: "traffic", budgetAmount: 20 } as const;

describe("ads input rules", () => {
  it("defaults to paused, daily and no special category", () => {
    const parsed = createCampaignInput.parse(campaign);
    expect(parsed).toMatchObject({ status: "paused", budgetType: "daily", budgetLevel: "campaign", specialAdCategories: [], attributionModel: "default" });
  });
  it("needs an end date for a lifetime budget and orders the dates", () => {
    expect(createCampaignInput.safeParse({ ...campaign, budgetType: "lifetime" }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, budgetType: "lifetime", endDate: "2027-01-10" }).success).toBe(true);
    expect(createCampaignInput.safeParse({ ...campaign, startDate: "2027-02-01", endDate: "2027-01-01" }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, startDate: "2027-02-30" }).success).toBe(false);
  });
  it("rejects unknown fields, bad money and goals", () => {
    expect(createCampaignInput.safeParse({ ...campaign, extra: 1 }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, budgetAmount: 0 }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, budgetAmount: 10.123 }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, goal: "sales" }).success).toBe(false);
  });
  it("checks every ad format", () => {
    const card = { mediaRef: "m1" };
    expect(creativeSchema.safeParse({ format: "carousel", cards: [card] }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "carousel", cards: [card, card] }).success).toBe(true);
    expect(creativeSchema.safeParse({ format: "carousel", cards: Array(11).fill(card) }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "image" }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "video", mediaRefs: ["m"] }).success).toBe(true);
    expect(creativeSchema.safeParse({ format: "messaging" }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "messaging", messagingDestination: "whatsapp" }).success).toBe(true);
    expect(creativeSchema.safeParse({ format: "call", phoneNumber: "5551234" }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "call", phoneNumber: "+15551234567" }).success).toBe(true);
    expect(creativeSchema.safeParse({ format: "text" }).success).toBe(true);
    expect(creativeSchema.safeParse({ format: "event" }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "document" }).success).toBe(false);
    expect(creativeSchema.safeParse({ format: "image", mediaRefs: ["m"], cards: [card, card] }).success).toBe(false);
  });
  it("needs a lead form for lead generation ads", () => {
    expect(createCampaignInput.safeParse({ ...campaign, goal: "lead_generation", creative: { format: "image", mediaRefs: ["m"] } }).success).toBe(false);
    expect(createCampaignInput.safeParse({ ...campaign, goal: "lead_generation", creative: { format: "image", mediaRefs: ["m"], leadFormId: id } }).success).toBe(true);
  });
  it("accepts the documented targeting and keeps raw targeting out of the typed shape", () => {
    expect(targetingSchema.safeParse({ countries: ["US"], ageMin: 25, ageMax: 55, genders: ["all"], interests: [{ id: "1" }], pins: [{ lat: 1, lng: 2, radiusKm: 10 }],
      excludedLocations: [{ kind: "city", ref: "x" }], languages: ["en"], includeAudiences: ["a"], excludeAudiences: ["b"], savedTargetingId: "s" }).success).toBe(true);
    expect(targetingSchema.safeParse({ ageMin: 60, ageMax: 20 }).success).toBe(false);
    expect(targetingSchema.safeParse({ raw: {} }).success).toBe(false);
    expect(targetingSchema.safeParse({ countries: ["usa"] }).success).toBe(false);
  });
  it("validates boost and add-ad and picks the schema by kind", () => {
    expect(boostInput.safeParse({ adAccountId: id, name: "b", postRef: "p1", goal: "engagement", budgetAmount: 5 }).success).toBe(true);
    expect(addAdInput.safeParse({ adAccountId: id, adSetId: id, name: "a", creative: { format: "text" } }).success).toBe(true);
    expect(() => launchPayload("boost", campaign)).toThrow();
  });
  it("refuses political or issue ads", () => {
    expect(isRefusedCategory({ specialAdCategories: ["social_issues_elections_politics"] })).toBe(true);
    expect(isRefusedCategory({ specialAdCategories: ["housing"] })).toBe(false);
  });
  it("needs confirmation and a change for a budget edit", () => {
    const base = { level: "campaign", id, version: 1, idempotencyKey: id };
    expect(budgetInput.safeParse({ ...base, budgetAmount: 5 }).success).toBe(false);
    expect(budgetInput.safeParse({ ...base, confirm: true }).success).toBe(false);
    expect(budgetInput.safeParse({ ...base, confirm: true, budgetAmount: 5 }).success).toBe(true);
  });
  it("only moves between active and paused for live entities", () => {
    expect(canMove("active", "paused")).toBe(true);
    expect(canMove("paused", "paused")).toBe(false);
    expect(canMove("archived", "active")).toBe(false);
    expect(canMove("deleted", "paused")).toBe(false);
  });
});

describe("ads results", () => {
  it("keeps only numeric counts and recomputes ratios; a missing metric is unavailable, not zero", () => {
    const m = projectResults({ spend: 10, impressions: 1000, clicks: 50, results: 5, ctr: 99, junk: 1, reach: "x" });
    expect(m).toEqual({ spend: 10, impressions: 1000, clicks: 50, results: 5, ctr: 99 });
    const d = deriveRatios(m);
    expect(d.ctr).toBeCloseTo(0.05); expect(d.cpc).toBeCloseTo(0.2); expect(d.cpm).toBeCloseTo(10); expect(d.costPerResult).toBeCloseTo(2);
    expect(reading({}, "spend")).toEqual({ value: null, availability: "unavailable" });
    expect(reading({ spend: 0 }, "spend")).toEqual({ value: 0, availability: "available" });
    expect(deriveRatios({ spend: 5 }).costPerResult).toBeUndefined();
  });
  it("evaluates rules and never fires on an unreported metric", () => {
    expect(evaluateRule({ metric: "costPerResult", operator: "gt", threshold: 3 }, { costPerResult: 4 })).toBe(true);
    expect(evaluateRule({ metric: "costPerResult", operator: "gt", threshold: 3 }, {})).toBe(false);
    expect(evaluateRule({ metric: "spend", operator: "lte", threshold: 0 }, { spend: 0 })).toBe(true);
  });
});

describe("ads hard-off and webhook parsing", () => {
  it("is off by literal constants and the vendor adapter refuses everything", async () => {
    expect(ADS_INTEGRATION_ENABLED).toBe(false); expect(ZERNIO_ADS_LIVE_NETWORK).toBe(false);
    expect(defaultAdsDeps().enabled).toBe(false);
    const adapter = new ZernioAdsAdapter() as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    for (const name of ["listAdAccounts", "launch", "setBudget", "sendConversionEvents", "listLeads", "remove"]) await expect(adapter[name]({ secret: "x" })).rejects.toMatchObject({ code: "DISABLED" });
  });
  it("refuses conversion sends in the fake too and records the attempt", async () => {
    const fake = new FakeAdsProvider("k"); fake.addAccount("a", { ref: "x" });
    await expect(fake.sendConversionEvents({ secret: "k" }, { accountRef: "a", adAccountRef: "x", destinationRef: "d", idempotencyKey: id, events: [] })).rejects.toMatchObject({ code: "DISABLED" });
    expect(fake.refusedConversionSends).toHaveLength(1);
  });
  it("parses only known, well-formed events", () => {
    const base = { id: "e1", type: "lead.received", accountRef: "act", timestamp: "2026-11-25T10:00:00Z", subjectRef: "l1", data: { fields: { email: "a@b.c" } } };
    expect(parseAdsEvent(JSON.stringify(base))).toMatchObject({ eventId: "e1", type: "lead.received", subjectRef: "l1" });
    for (const bad of [{ ...base, type: "other" }, { ...base, id: "" }, { ...base, timestamp: "nope" }, { ...base, accountRef: 3 }, { ...base, subjectRef: 3 }]) expect(parseAdsEvent(JSON.stringify(bad))).toBeNull();
    expect(parseAdsEvent("not json")).toBeNull(); expect(parseAdsEvent("[]")).toBeNull();
  });
});

import { adConsentQuestions, audienceUploadInput, conversionEventNames, conversionSendInput, isEeaUkChPhone, normaliseEmail, normalisePhone } from "../../src/lib/ads/ads";
import { adsFeature } from "../../src/server/ads/registry";
describe("ads CRM rules", () => {
  it("normalises identifiers before hashing and spots EEA, UK and Swiss phone numbers", () => {
    expect(normaliseEmail("  Anna@Example.TEST ")).toBe("anna@example.test");
    expect(normalisePhone("+1 (202) 555-0142")).toBe("12025550142");
    for (const phone of ["+49 151 555", "+44 20 7946 0000", "+41 44 668 18 00", "+353 1 234", "+33 1 23"]) expect(isEeaUkChPhone(phone), phone).toBe(true);
    for (const phone of ["+1 202 555 0142", "+61 2 9999 0000", "+234 1 234", "2025550142", "", null, undefined]) expect(isEeaUkChPhone(phone as string), String(phone)).toBe(false);
  });
  it("needs explicit confirmation and ids for uploads and sends, and only the two consent questions exist", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(audienceUploadInput.safeParse({ adAccountId: id, audienceId: id, idempotencyKey: id }).success).toBe(false);
    expect(audienceUploadInput.safeParse({ adAccountId: id, audienceId: id, idempotencyKey: id, confirm: true }).success).toBe(true);
    expect(conversionSendInput.safeParse({ adAccountId: id, destinationId: id, eventName: "Purchase", leadIds: [id], idempotencyKey: id, confirm: true }).success).toBe(false);
    expect(conversionSendInput.safeParse({ adAccountId: id, destinationId: id, eventName: "Lead", leadIds: [], idempotencyKey: id, confirm: true }).success).toBe(false);
    expect(conversionSendInput.safeParse({ adAccountId: id, destinationId: id, eventName: conversionEventNames[0], leadIds: [id], idempotencyKey: id, confirm: true }).success).toBe(true);
    expect(adConsentQuestions).toEqual(["consent_newsletter", "consent_follow_up"]);
  });
  it("keeps every send path off unless a test turns it on", () => {
    const d = defaultAdsDeps();
    for (const name of ["audienceUpload", "conversionsSend", "resultsSync"] as const) { expect(adsFeature(d, name)).toBe(false); expect(adsFeature({ features: { [name]: true } }, name)).toBe(true); }
  });
});
