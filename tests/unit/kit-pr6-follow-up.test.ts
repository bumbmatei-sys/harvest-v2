import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { counselorTransitions, followUpCaseStates, followUpTransitionAllowed, followUpTransitions, type FollowUpCaseState } from "../../src/lib/follow-up-cases";
import { canManageFollowUp, canOpenFollowUp, caseActions, caseEvents, caseReference, caseTracker, consequentialMoves, followUpTone, parseQueueQuery, queueHref, queueTabs } from "../../src/lib/follow-up-ui";
import { permissionPreset } from "../../src/lib/consent-controls";
import { PermissionCard } from "../../src/components/permission-card";
import { StatusTracker } from "../../src/components/status-tracker";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));
const roles = ["owner", "admin", "member", "viewer", "stranger", undefined] as const;

describe("who sees the follow-up screens", () => {
  it("opens the queue for owner, admin and member only", () => {
    expect(roles.map((role) => canOpenFollowUp(role))).toEqual([true, true, true, false, false, false]);
    expect(roles.map((role) => canManageFollowUp(role))).toEqual([true, true, false, false, false, false]);
  });
  it("offers a counselor only open states and a viewer nothing", () => {
    expect(queueTabs("viewer")).toEqual([]);
    expect(queueTabs(undefined)).toEqual([]);
    expect(queueTabs("member")).toEqual(["all", "assigned", "attempted", "no_response", "connected"]);
    expect(queueTabs("owner")).toEqual(["all", ...followUpCaseStates]);
    expect(queueTabs("admin")).toEqual(queueTabs("owner"));
  });
});

describe("queue URL state", () => {
  it("reads a known state and a plain cursor, and ignores anything else", () => {
    expect(parseQueueQuery({ state: "assigned", cursor: "abc_-123" }, "owner")).toEqual({ state: "assigned", cursor: "abc_-123" });
    expect(parseQueueQuery({ state: "nonsense" })).toEqual({ state: "all" });
    expect(parseQueueQuery({ state: ["assigned", "closed"] })).toEqual({ state: "all" });
    expect(parseQueueQuery({ cursor: "has space" })).toEqual({ state: "all" });
    expect(parseQueueQuery({ cursor: "x".repeat(201) })).toEqual({ state: "all" });
  });
  it("drops a filter the role cannot use", () => {
    expect(parseQueueQuery({ state: "closed" }, "member")).toEqual({ state: "all" });
    expect(parseQueueQuery({ state: "closed" }, "admin")).toEqual({ state: "closed" });
    expect(parseQueueQuery({ state: "closed" }, "viewer")).toEqual({ state: "all" });
  });
  it("builds links that round-trip", () => {
    expect(queueHref("/q", { state: "all" })).toBe("/q");
    expect(queueHref("/q", { state: "attempted" })).toBe("/q?state=attempted");
    expect(queueHref("/q", { state: "all", cursor: "c1" })).toBe("/q?cursor=c1");
    expect(parseQueueQuery(Object.fromEntries(new URL(queueHref("http://x/q", { state: "closed", cursor: "c1" })).searchParams))).toEqual({ state: "closed", cursor: "c1" });
  });
});

describe("case presentation helpers", () => {
  it("gives every state a tone and a short reference", () => {
    for (const state of followUpCaseStates) expect(["pending", "warning", "info", "success", "neutral", "danger"]).toContain(followUpTone(state));
    expect(followUpTone("connected")).toBe("success");
    expect(followUpTone("withdrawn")).toBe("danger");
    expect(caseReference("0a1b2c3d-1111-4222-8333-444455556666")).toBe("0A1B2C3D");
  });
  it("tracks the main path and swaps in the side states", () => {
    expect(caseTracker("assigned").steps.map((step) => step.id)).toEqual(["requested", "awaiting_assignment", "assigned", "attempted", "connected", "closed"]);
    expect(caseTracker("no_response").steps.map((step) => step.id)).toEqual(["requested", "awaiting_assignment", "assigned", "attempted", "no_response", "closed"]);
    expect(caseTracker("withdrawn")).toMatchObject({ tone: "danger" });
    expect(caseTracker("withdrawn").steps.at(-1)?.id).toBe("withdrawn");
    expect(caseTracker("closed").tone).toBe("success");
    for (const state of followUpCaseStates) expect(caseTracker(state).steps.some((step) => step.id === state), state).toBe(true);
  });
  it("lists only the events the record proves, oldest first, without duplicating an assignment", () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 10, minutes));
    expect(caseEvents({ state: "requested", createdAt: at(0), assignedAt: null, stateChangedAt: at(0) }).map((event) => event.kind)).toEqual(["opened"]);
    expect(caseEvents({ state: "assigned", createdAt: at(0), assignedAt: at(5), stateChangedAt: at(5) }).map((event) => event.kind)).toEqual(["opened", "assigned"]);
    expect(caseEvents({ state: "attempted", createdAt: at(0), assignedAt: at(5), stateChangedAt: at(9) }).map((event) => event.kind)).toEqual(["opened", "assigned", "state"]);
    expect(caseEvents({ state: "withdrawn", createdAt: at(0), assignedAt: null, stateChangedAt: at(3) })).toEqual([{ kind: "opened", at: at(0) }, { kind: "state", at: at(3), state: "withdrawn" }]);
  });
});

describe("controls follow the server rules", () => {
  it("shows owners and admins exactly the legal moves", () => {
    for (const role of ["owner", "admin"]) for (const state of followUpCaseStates) {
      const actions = caseActions(role, state, false);
      for (const move of actions.moves) expect(followUpTransitionAllowed(state, move), `${role} ${state} -> ${move}`).toBe(true);
      expect(actions.assign, `${state} assign`).toBe(followUpTransitionAllowed(state, "assigned"));
      expect(actions.unassign, `${state} unassign`).toBe(followUpTransitionAllowed(state, "awaiting_assignment") && state !== "requested");
      expect(actions.moves.includes("withdrawn"), `${state} withdraw`).toBe(followUpTransitions[state].includes("withdrawn"));
    }
  });
  it("never offers a terminal case any control, and never offers 'assigned' as a plain move", () => {
    for (const state of ["closed", "withdrawn"] as const) expect(caseActions("owner", state, false)).toEqual({ assign: false, unassign: false, moves: [] });
    for (const state of followUpCaseStates) expect(caseActions("owner", state, false).moves).not.toContain("assigned");
  });
  it("gives the assigned member the contact-progress moves and nobody else anything", () => {
    for (const state of followUpCaseStates) {
      expect(caseActions("member", state, true)).toEqual({ assign: false, unassign: false, moves: counselorTransitions[state] ?? [] });
      for (const role of ["member", "viewer", "stranger", undefined]) expect(caseActions(role, state, false), `${role} ${state} not assigned`).toEqual({ assign: false, unassign: false, moves: [] });
      expect(caseActions("viewer", state, true)).toEqual({ assign: false, unassign: false, moves: [] });
    }
  });
  it("asks for confirmation before a case ends", () => {
    expect([...consequentialMoves].sort()).toEqual(["closed", "withdrawn"]);
    for (const state of followUpCaseStates) for (const move of caseActions("member", state, true).moves) expect(consequentialMoves.includes(move as FollowUpCaseState), `${state} -> ${move}`).toBe(move === "closed");
  });
});

describe("consent presets", () => {
  it("lands an opt-in on the withdrawn channel and a withdrawal where the grant is", () => {
    expect(permissionPreset("outreach_follow_up", { status: "withdrawn", channel: "sms" }, "granted")).toEqual({ purpose: "outreach_follow_up", status: "granted", channel: "sms" });
    expect(permissionPreset("outreach_follow_up", { status: "granted", channel: "email" }, "withdrawn").channel).toBe("email");
    expect(permissionPreset("outreach_follow_up", { status: "none", channel: null }, "granted").channel).toBe("email");
    expect(permissionPreset("messaging", { status: "none", channel: null }, "granted").channel).toBe("social");
  });
});

describe("PermissionCard and the case tracker markup", () => {
  it("shows the state as text beside the label and renders actions only when given", () => {
    const withActions = render(h(PermissionCard, { label: "Follow-up: Email", status: { tone: "success", label: "Opted in" }, meta: "Opted in 1 Jan", actions: h("button", { type: "button" }, "Record withdrawal"), as: "li" }));
    expect(withActions).toContain("Follow-up: Email");
    expect(withActions).toContain("Opted in");
    expect(withActions).toContain("Record withdrawal");
    expect(withActions.startsWith("<li")).toBe(true);
    const plain = render(h(PermissionCard, { label: "Newsletter", status: { tone: "neutral", label: "No opt-in" } }));
    expect(plain).not.toContain("<button");
    expect(plain.startsWith("<div")).toBe(true);
  });
  it("marks one current step for a case", () => {
    const tracker = caseTracker("attempted");
    const html = render(h(StatusTracker, { steps: tracker.steps.map((step) => ({ id: step.id, label: step.id })), current: "attempted", label: "Case progress", tone: tracker.tone }));
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });
});
