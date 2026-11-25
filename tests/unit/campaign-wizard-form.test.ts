import { describe, expect, it } from "vitest";
import { adoptServer, dirtySteps, draftActions, formFromDraft, issuesOf, stepPayload, stepStatuses, type DraftView } from "../../src/lib/campaign-wizard-form";

const draft: DraftView = {
  id: "d1", createdBy: "u1", status: "draft", version: 3, currentStep: 3, type: "conference", name: "Synthetic conference", description: null, mission: null, country: null, cityRegion: null,
  startDate: null, endDate: null, timeZone: null, structure: null, departments: ["campaign_leadership"], modules: ["tasks_boards"],
  budget: { currency: "USD", estimatedBudgetMinor: null, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false },
  outreach: { registration: false, qrResponse: false, accountInvites: false, communityDiscovery: false, followUp: false, churchReferrals: false },
  assignments: [], issues: [], ready: false, campaignId: null,
};

describe("form and payloads", () => {
  it("builds the form from a draft and sends only valid steps, with the server's own schema", () => {
    const form = formFromDraft(draft);
    expect(stepPayload("type", form)).toEqual({ ok: true, data: { type: "conference" } });
    expect(stepPayload("basics", form)).toEqual({ ok: true, data: { name: "Synthetic conference", description: null, mission: null } });
    expect(stepPayload("basics", { ...form, basics: { ...form.basics, name: "  " } })).toMatchObject({ ok: false, problems: { name: "REQUIRED" } });
    expect(stepPayload("type", { ...form, type: null })).toMatchObject({ ok: false });
    const range = stepPayload("place", { ...form, place: { ...form.place, startDate: "2027-03-05", endDate: "2027-03-01" } });
    expect(range).toMatchObject({ ok: false, problems: { endDate: "INVALID_DATE_RANGE" } });
    expect(stepPayload("place", { ...form, place: { ...form.place, timeZone: "Not/AZone" } })).toMatchObject({ ok: false });
  });
  it("compares steps by what would be sent, so formatting alone is never a change", () => {
    const saved = formFromDraft(draft);
    expect(dirtySteps(saved, saved)).toEqual([]);
    expect(dirtySteps({ ...saved, basics: { ...saved.basics, name: "Synthetic conference  " } }, saved)).toEqual([]);
    expect(dirtySteps({ ...saved, basics: { ...saved.basics, name: "Renamed" } }, saved)).toEqual(["basics"]);
    expect(dirtySteps({ ...saved, place: { ...saved.place, country: "Chile" }, type: "mission_trip" }, saved)).toEqual(["type", "place"]);
    expect(dirtySteps({ ...saved, basics: { ...saved.basics, name: "" } }, saved)).toEqual(["basics"]);
  });
  it("keeps what was typed while a save was in flight and follows the server for untouched steps", () => {
    const before = formFromDraft(draft), typed = { ...before, basics: { ...before.basics, name: "Typed meanwhile" }, place: { ...before.place, country: "Thailand" } };
    const after = formFromDraft({ ...draft, version: 4, name: "Sent name", country: "Chile" });
    const merged = adoptServer(typed, before, after, "basics");
    expect(merged.basics.name).toBe("Typed meanwhile");
    expect(merged.place.country).toBe("Thailand");
    expect(adoptServer(before, before, after, "basics").place.country).toBe("Chile");
  });
});

describe("issues and statuses", () => {
  it("lists the same missing pieces as the server rules, live from the form", () => {
    expect(issuesOf(formFromDraft(draft), draft).map((issue) => issue.code)).toEqual(["STRUCTURE_REQUIRED", "DATES_REQUIRED", "TIME_ZONE_REQUIRED", "COUNTRY_REQUIRED"]);
    const complete = { ...formFromDraft(draft), place: { country: "Thailand", cityRegion: "", startDate: "2027-03-01", endDate: "2027-03-05", timeZone: "Asia/Bangkok", structure: "single" as const } };
    expect(issuesOf(complete, draft)).toEqual([]);
  });
  it("marks passed editable steps done or needing attention; later steps are never marked", () => {
    const states = stepStatuses([{ step: "place", code: "DATES_REQUIRED" }], 5);
    expect(states).toMatchObject({ type: "done", basics: "done", place: "attention", leaders: "todo", review: "todo" });
    expect(stepStatuses([{ step: "place", code: "DATES_REQUIRED" }], 2).place).toBe("todo");
  });
});

describe("draft actions", () => {
  it("lets the creator continue and discard, and owners and admins discard any draft", () => {
    expect(draftActions({ createdBy: "u1" }, "u1", "member")).toEqual({ edit: true, discard: true });
    expect(draftActions({ createdBy: "u1" }, "u2", "member")).toEqual({ edit: false, discard: false });
    expect(draftActions({ createdBy: "u1" }, "u2", "admin")).toEqual({ edit: false, discard: true });
  });
});
