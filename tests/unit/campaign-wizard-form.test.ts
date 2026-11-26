import { describe, expect, it } from "vitest";
import { adoptServer, dirtySteps, draftActions, formFromDraft, issuesOf, moneyText, outreachBlocked, parseMoney, setOutreach, stepPayload, stepStatuses, type DraftView } from "../../src/lib/campaign-wizard-form";

const draft: DraftView = {
  id: "d1", createdBy: "u1", status: "draft", version: 3, currentStep: 3, type: "conference", name: "Synthetic conference", description: null, mission: null, country: null, cityRegion: null,
  startDate: null, endDate: null, timeZone: null, structure: null, departments: ["campaign_leadership"], modules: ["tasks_boards"],
  budget: { currency: "USD", estimatedBudgetMinor: null, fundraisingEnabled: false, fundraisingGoalMinor: null, onlineDonations: false },
  outreach: { registration: false, qrResponse: false, accountInvites: false, communityDiscovery: false, followUp: false, churchReferrals: false },
  assignments: [], invitations: [], issues: [], ready: false, campaignId: null, coverFileId: null,
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
  it("sends departments and tools in the PRD order and compares them as sets", () => {
    const saved = formFromDraft({ ...draft, departments: ["volunteers", "campaign_leadership"], modules: ["campaign_calendar", "tasks_boards"] });
    expect(stepPayload("leaders", saved)).toEqual({ ok: true, data: { departments: ["campaign_leadership", "volunteers"] } });
    expect(stepPayload("tools", saved)).toEqual({ ok: true, data: { modules: ["tasks_boards", "campaign_calendar"] } });
    expect(dirtySteps({ ...saved, leaders: { departments: ["campaign_leadership", "volunteers"] } }, saved)).toEqual([]);
    expect(dirtySteps({ ...saved, tools: { modules: [...saved.tools.modules, "communications"] } }, saved)).toEqual(["tools"]);
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
    expect(states).toMatchObject({ type: "done", basics: "done", place: "attention", leaders: "done", tools: "todo", review: "todo" });
    expect(stepStatuses([{ step: "place", code: "DATES_REQUIRED" }], 2).place).toBe("todo");
  });
});

describe("draft actions", () => {
  it("lets anyone who can write continue any draft, and only the creator, owners and admins discard it", () => {
    expect(draftActions({ createdBy: "u1" }, "u1", "member")).toEqual({ edit: true, discard: true });
    expect(draftActions({ createdBy: "u1" }, "u2", "member")).toEqual({ edit: true, discard: false });
    expect(draftActions({ createdBy: "u1" }, "u2", "admin")).toEqual({ edit: true, discard: true });
    expect(draftActions({ createdBy: "u1" }, "u2", "viewer")).toEqual({ edit: false, discard: false });
  });
});

describe("step 7: registration, response and follow-up", () => {
  const off = draft.outreach;
  it("starts with everything off and the dependent cards blocked with a reason", () => {
    expect(Object.values(off).every((on) => !on)).toBe(true);
    expect(outreachBlocked(off)).toEqual({ accountInvites: "NEEDS_REGISTRATION_OR_RESPONSE", followUp: "NEEDS_REGISTRATION_OR_RESPONSE", churchReferrals: "NEEDS_REGISTRATION_OR_RESPONSE", communityDiscovery: "NEEDS_ACCOUNT_INVITES" });
    const registered = setOutreach(off, "registration", true);
    expect(outreachBlocked(registered)).toEqual({ communityDiscovery: "NEEDS_ACCOUNT_INVITES" });
    expect(outreachBlocked(setOutreach(registered, "accountInvites", true))).toEqual({});
    expect(outreachBlocked(setOutreach(off, "qrResponse", true)).followUp).toBeUndefined(); // the response form alone is enough
  });
  it("turns off whatever lost its ground, so what is saved always satisfies the server's rules", () => {
    let on = setOutreach(setOutreach(setOutreach(setOutreach(off, "registration", true), "accountInvites", true), "communityDiscovery", true), "followUp", true);
    expect(stepPayload("connect", { ...formFromDraft(draft), connect: on }).ok).toBe(true);
    on = setOutreach(on, "accountInvites", false);
    expect(on).toMatchObject({ communityDiscovery: false, followUp: true });
    on = setOutreach(on, "registration", false);
    expect(on).toEqual(off);
    expect(stepPayload("connect", { ...formFromDraft(draft), connect: on }).ok).toBe(true);
    // A hand-made invalid combination is refused by the shared schema, not sent.
    expect(stepPayload("connect", { ...formFromDraft(draft), connect: { ...off, followUp: true } }).ok).toBe(false);
  });
  it("reports a missing tool as an issue and counts the step as changed only when an option changes", () => {
    const form = { ...formFromDraft(draft), connect: setOutreach(off, "qrResponse", true) };
    expect(issuesOf(form, draft)).toContainEqual({ step: "tools", code: "QR_MODULE_OFF" });
    expect(dirtySteps(form, formFromDraft(draft))).toEqual(["connect"]);
    expect(dirtySteps(formFromDraft(draft), formFromDraft(draft))).toEqual([]);
  });
});

describe("step 6: budget and fundraising", () => {
  const form = formFromDraft(draft);
  it("turns typed amounts into minor units for the currency's own decimals, and refuses anything else", () => {
    expect(parseMoney("1250.5", "USD")).toEqual({ ok: true, minor: 125050 });
    expect(parseMoney("1250", "USD")).toEqual({ ok: true, minor: 125000 });
    expect(parseMoney("1250", "JPY")).toEqual({ ok: true, minor: 1250 });
    expect(parseMoney("", "USD")).toEqual({ ok: true, minor: null });
    for (const bad of ["12.345", "1,250", "-5", "1e3", "abc", "12.", ".5", "99999999999999"]) expect(parseMoney(bad, "USD")).toEqual({ ok: false });
    expect(parseMoney("1250.5", "JPY")).toEqual({ ok: false });
  });
  it("shows saved minor units as the text a person types", () => {
    expect(moneyText(125050, "USD")).toBe("1250.5");
    expect(moneyText(125000, "USD")).toBe("1250");
    expect(moneyText(5, "USD")).toBe("0.05");
    expect(moneyText(1250, "JPY")).toBe("1250");
    expect(moneyText(null, "USD")).toBe("");
    for (const minor of [0, 1, 99, 100, 101, 123456789]) expect(parseMoney(moneyText(minor, "USD"), "USD")).toEqual({ ok: true, minor });
  });
  it("sends exactly the five fields, and not the goal or online donations without fundraising", () => {
    const base = { ...form, budget: { currency: "EUR", estimated: "2000", fundraisingEnabled: true, goal: "5000.25", onlineDonations: true } };
    expect(stepPayload("budget", base)).toEqual({ ok: true, data: { currency: "EUR", estimatedBudgetMinor: 200000, fundraisingEnabled: true, fundraisingGoalMinor: 500025, onlineDonations: true } });
    const blocked = stepPayload("budget", { ...base, budget: { ...base.budget, fundraisingEnabled: false } });
    expect(blocked.ok).toBe(false);
    expect(stepPayload("budget", { ...base, budget: { ...base.budget, estimated: "2k" } })).toEqual({ ok: false, problems: { estimated: "INVALID" } });
    expect(stepPayload("budget", { ...base, budget: { ...base.budget, fundraisingEnabled: false, goal: "", onlineDonations: false } }).ok).toBe(true);
  });
  it("reports fundraising without its tool and counts the step as changed only when an answer changes", () => {
    const on = { ...form, budget: { ...form.budget, fundraisingEnabled: true } };
    expect(issuesOf(on, draft)).toContainEqual({ step: "tools", code: "FUNDRAISING_MODULE_OFF" });
    expect(dirtySteps(on, form)).toEqual(["budget"]);
    expect(dirtySteps({ ...form, budget: { ...form.budget, estimated: " " } }, form)).toEqual([]); // whitespace is no figure
  });
});
