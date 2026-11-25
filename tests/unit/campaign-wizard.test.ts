import { describe, expect, it } from "vitest";
import { can } from "../../src/lib/permissions";
import { campaignTemplates, checklistInput, checklistItemKeys, derivedChecklist, invitationInput, departmentKeys, moduleKeys, placeIssues, saveInput, validateDraft, wizardSteps, type DraftSnapshot } from "../../src/lib/campaign-wizard";

const empty: DraftSnapshot = { type: null, name: null, country: null, cityRegion: null, startDate: null, endDate: null, timeZone: null, structure: null,
  departments: [], modules: [], budget: { currency: "USD", estimatedBudgetMinor: null, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false },
  outreach: { registration: false, qrResponse: false, accountInvites: false, communityDiscovery: false, followUp: false, churchReferrals: false } };
const ready: DraftSnapshot = { ...empty, type: "conference", name: "Synthetic conference", country: "Thailand", startDate: "2027-03-01", endDate: "2027-03-05", timeZone: "Asia/Bangkok", structure: "single" };
const save = (step: string, data: unknown) => saveInput.safeParse({ version: 1, step, data });

describe("campaign wizard rules", () => {
  it("has eight steps and templates built only from known departments and tools", () => {
    expect(wizardSteps).toHaveLength(8);
    for (const template of Object.values(campaignTemplates)) {
      expect(template.departments.every((key) => departmentKeys.includes(key))).toBe(true);
      expect(template.modules.every((key) => moduleKeys.includes(key))).toBe(true);
      expect(template.modules).not.toContain("ai_copilot");
      expect(template.departments).toContain("campaign_leadership");
    }
    expect(campaignTemplates.evangelistic_crusade.departments).toHaveLength(13);
  });
  it("lists every missing piece of an unfinished draft and none for a ready one", () => {
    expect(validateDraft(empty).map((i) => i.code)).toEqual(["TYPE_REQUIRED", "NAME_REQUIRED", "STRUCTURE_REQUIRED", "DATES_REQUIRED", "TIME_ZONE_REQUIRED", "COUNTRY_REQUIRED"]);
    expect(validateDraft(ready)).toEqual([]);
    expect(placeIssues({ ...ready, structure: "online_hybrid", country: null })).toEqual([]);
  });
  it("ties tools to the fundraising and response settings", () => {
    const issues = validateDraft({ ...ready, budget: { ...ready.budget, fundraisingEnabled: true }, outreach: { ...ready.outreach, qrResponse: true, registration: true } }).map((i) => i.code);
    expect(issues).toEqual(["FUNDRAISING_MODULE_OFF", "QR_MODULE_OFF", "REGISTRATION_MODULE_OFF"]);
    expect(validateDraft({ ...ready, modules: ["fundraising_donations", "qr_response_forms", "registration_forms"], budget: { ...ready.budget, fundraisingEnabled: true }, outreach: { ...ready.outreach, qrResponse: true, registration: true } })).toEqual([]);
  });
  it("accepts a partial autosave but rejects bad shapes per step", () => {
    expect(save("basics", { name: "  Trimmed ", description: "" }).success).toBe(true);
    expect(save("basics", { name: "" }).success).toBe(false);
    expect(save("basics", { name: "x", extra: 1 }).success).toBe(false);
    expect(save("place", { startDate: "2027-03-05", endDate: "2027-03-01" }).success).toBe(false);
    expect(save("place", { timeZone: "Not/AZone" }).success).toBe(false);
    expect(save("place", { country: "Thailand" }).success).toBe(true);
    expect(save("review", {}).success).toBe(false);
    expect(save("type", { type: "party" }).success).toBe(false);
    expect(save("tools", { modules: ["tasks_boards", "tasks_boards"] }).success).toBe(false);
  });
  it("saves the departments only, unique, and takes invitations by member or by email", () => {
    expect(save("leaders", { departments: ["volunteers", "counseling"] }).success).toBe(true);
    expect(save("leaders", { departments: ["volunteers", "volunteers"] }).success).toBe(false);
    expect(save("leaders", { departments: ["volunteers"], assignments: [] }).success).toBe(false);
    const member = invitationInput.safeParse({ department: "volunteers", role: "leader", userId: "u1" });
    expect(member.success).toBe(true);
    expect(invitationInput.parse({ department: "volunteers", role: "member", email: "  New.Person@Example.TEST " }).email).toBe("new.person@example.test");
    expect(invitationInput.safeParse({ department: "volunteers", role: "member" }).success).toBe(false);
    expect(invitationInput.safeParse({ department: "volunteers", role: "member", userId: "u1", email: "a@b.co" }).success).toBe(false);
    expect(invitationInput.safeParse({ department: "volunteers", role: "member", email: "not an email" }).success).toBe(false);
    expect(invitationInput.safeParse({ department: "nope", role: "member", userId: "u1" }).success).toBe(false);
  });
  it("keeps donations and goals behind the fundraising switch and responses behind a way to respond", () => {
    const budget = { currency: "USD", estimatedBudgetMinor: 1000, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false };
    expect(save("budget", budget).success).toBe(true);
    expect(save("budget", { ...budget, onlineDonations: true }).success).toBe(false);
    expect(save("budget", { ...budget, fundraisingGoalMinor: 5 }).success).toBe(false);
    expect(save("budget", { ...budget, currency: "usd" }).success).toBe(false);
    expect(save("budget", { ...budget, estimatedBudgetMinor: -1 }).success).toBe(false);
    const connect = { registration: false, qrResponse: false, accountInvites: false, communityDiscovery: false, followUp: false, churchReferrals: false };
    expect(save("connect", { ...connect, followUp: true }).success).toBe(false);
    expect(save("connect", { ...connect, qrResponse: true, followUp: true }).success).toBe(true);
    expect(save("connect", { ...connect, registration: true, communityDiscovery: true }).success).toBe(false);
  });
  it("follows the role rules: members write, only owners and admins activate, viewers read", () => {
    expect([can("member", "campaigns:write"), can("viewer", "campaigns:write"), can("viewer", "campaigns:read")]).toEqual([true, false, true]);
    expect(["owner", "admin", "member", "viewer"].map((role) => can(role, "campaigns:activate"))).toEqual([true, true, false, false]);
  });
});


describe("setup checklist", () => {
  it("lists the nine PRD items and accepts only them", () => {
    expect(checklistItemKeys).toHaveLength(9);
    expect(checklistInput.safeParse({ item: "define_budget", done: true }).success).toBe(true);
    expect(checklistInput.safeParse({ item: "anything", done: true }).success).toBe(false);
    expect(checklistInput.safeParse({ item: "define_budget", done: "yes" }).success).toBe(false);
    expect(checklistInput.safeParse({ item: "define_budget", done: true, extra: 1 }).success).toBe(false);
  });
  it("ticks leader items only from real leaders", () => {
    expect(derivedChecklist([], [])).toMatchObject({ assign_leaders: false, assign_counseling: false });
    expect(derivedChecklist(["volunteers", "counseling"], ["volunteers"])).toMatchObject({ assign_leaders: false, assign_counseling: false });
    expect(derivedChecklist(["volunteers", "counseling"], ["volunteers", "counseling"])).toMatchObject({ assign_leaders: true, assign_counseling: true });
    expect(derivedChecklist(["volunteers"], ["counseling"])).toMatchObject({ assign_leaders: false, assign_counseling: false }); // a leader of a department that is not included counts for nothing
    expect(Object.entries(derivedChecklist(["volunteers"], ["volunteers"])).filter(([, on]) => on).map(([key]) => key)).toEqual(["assign_leaders"]);
  });
});
