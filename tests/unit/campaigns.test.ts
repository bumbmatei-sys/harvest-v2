import { describe, expect, it } from "vitest";
import { campaignIdempotencyKey, campaignInput, campaignPage, campaignTypes } from "../../src/lib/campaigns";
import { can } from "../../src/server/permissions";

describe("campaign draft input", () => {
  it.each(campaignTypes)("accepts PRD type %s with optional draft fields", (type) => {
    expect(campaignInput.parse({ name: "  Summer campaign  ", type })).toMatchObject({ name: "Summer campaign", type, mission: null, structure: null, startDate: null, timeZone: null });
  });
  it("normalizes optional text and accepts a leap day and IANA time zone", () => {
    expect(campaignInput.parse({ name: "Leap", type: "mission_trip", description: "  ", country: " Thailand ", startDate: "2028-02-29", endDate: "2028-03-01", timeZone: "Asia/Bangkok", structure: "multi" }))
      .toMatchObject({ description: null, country: "Thailand", timeZone: "Asia/Bangkok" });
  });
  it.each([
    { name: " " }, { name: "x".repeat(201) }, { type: "outreach" }, { status: "active" }, { ownerUserId: "other" }, { tenantId: "other" },
    { startDate: "2027-02-29" }, { startDate: "2027-03-02", endDate: "2027-03-01" }, { timeZone: "Mars/Olympus" }, { structure: "venues" },
    { coverImage: "later" }, { modules: [] },
  ])("rejects invalid input or fields from later slices: %j", (change) => {
    expect(campaignInput.safeParse({ name: "Draft", type: "conference", ...change }).success).toBe(false);
  });
  it("requires a bounded opaque idempotency key and a positive page", () => {
    for (const key of [null, "", " ", "x".repeat(201), "key\n"]) expect(campaignIdempotencyKey.safeParse(key).success).toBe(false);
    expect(campaignIdempotencyKey.parse("campaign:01_retry-2")).toBe("campaign:01_retry-2");
    expect(campaignPage.parse(undefined)).toBe(1);
    for (const page of ["0", "-1", "1.5", "10001", "all"]) expect(campaignPage.safeParse(page).success).toBe(false);
  });
  it("lets workspace roles read; only owners, admins and members create", () => {
    for (const role of ["owner", "admin", "member", "viewer"]) {
      expect(can(role, "campaigns:read")).toBe(true);
      expect(can(role, "campaigns:write")).toBe(role !== "viewer");
    }
    expect(can("outsider", "campaigns:read")).toBe(false);
    expect(can("outsider", "campaigns:write")).toBe(false);
  });
});
