import { describe, expect, it } from "vitest";
import { can, roleIds } from "../../src/lib/permissions";
import { counselorTransitions, FOLLOW_UP_PAGE_DEFAULT, FOLLOW_UP_PAGE_MAX, followUpAssignInput, followUpCaseStates, followUpOpenInput, followUpPageInput, followUpTerminalStates,
  followUpTransitionAllowed, followUpTransitionInput, followUpTransitionTargets, followUpTransitions } from "../../src/lib/follow-up-cases";

describe("follow-up permission rules (HC-13)", () => {
  it("lets only owners and admins manage cases", () => {
    expect(roleIds.map((role) => can(role, "followup:manage"))).toEqual([true, true, false, false]);
  });
  it("lets owners, admins and members work cases (the database adds the assignment) and never viewers", () => {
    expect(roleIds.map((role) => can(role, "followup:work"))).toEqual([true, true, true, false]);
  });
  it("denies unknown roles every case permission", () => {
    for (const role of ["", "counselor", "superadmin", "Owner", "owner "]) for (const permission of ["followup:manage", "followup:work"] as const) expect(can(role, permission), `${role}/${permission}`).toBe(false);
  });
});

describe("follow-up lifecycle table", () => {
  it("lists every state once, with terminal states that go nowhere", () => {
    expect(new Set(followUpCaseStates).size).toBe(followUpCaseStates.length);
    expect(Object.keys(followUpTransitions).sort()).toEqual([...followUpCaseStates].sort());
    for (const state of followUpTerminalStates) expect(followUpTransitions[state]).toEqual([]);
  });
  it("only allows moves between known states, and repeats a state only for a reassignment", () => {
    for (const from of followUpCaseStates) for (const to of followUpTransitions[from]) {
      expect(followUpCaseStates).toContain(to);
      if (from === to) expect(from).toBe("assigned");
    }
  });
  it("starts at requested and reaches every other state", () => {
    const reached = new Set<string>(["requested"]); const queue = ["requested"];
    while (queue.length) for (const to of followUpTransitions[queue.shift() as keyof typeof followUpTransitions]) if (!reached.has(to)) { reached.add(to); queue.push(to); }
    expect([...reached].sort()).toEqual([...followUpCaseStates].sort());
  });
  it("gives a counselor only moves the lifecycle allows, none into assignment, withdrawal or the queue", () => {
    for (const [from, targets] of Object.entries(counselorTransitions)) for (const to of targets!) {
      expect(followUpTransitionAllowed(from as never, to)).toBe(true);
      expect(["assigned", "withdrawn", "awaiting_assignment", "requested"]).not.toContain(to);
    }
    expect(Object.keys(counselorTransitions)).not.toEqual(expect.arrayContaining(["requested", "awaiting_assignment", "closed", "withdrawn"]));
  });
  it("never names assigned or requested as a plain transition target", () => {
    expect(followUpTransitionTargets).not.toContain("assigned"); expect(followUpTransitionTargets).not.toContain("requested");
    for (const target of followUpTransitionTargets) expect(followUpCaseStates).toContain(target);
  });
});

describe("follow-up inputs", () => {
  it("bounds paging and rejects unknown keys and states", () => {
    expect(FOLLOW_UP_PAGE_DEFAULT).toBe(50); expect(FOLLOW_UP_PAGE_MAX).toBe(200);
    expect(followUpPageInput.parse({ limit: 100000 }).limit).toBe(100000); // clamped to the maximum by the service
    for (const bad of [{ limit: 0 }, { limit: -1 }, { limit: 1.5 }, { state: "bogus" }, { extra: 1 }, { cursor: "x".repeat(201) }]) expect(() => followUpPageInput.parse(bad)).toThrow();
    expect(() => followUpOpenInput.parse({ limit: 0 })).toThrow(); expect(() => followUpOpenInput.parse({ extra: true })).toThrow();
  });
  it("requires a version on every write, allows a null assignee only to unassign and rejects unknown keys", () => {
    expect(followUpAssignInput.parse({ assigneeId: null, version: 1 })).toEqual({ assigneeId: null, version: 1 });
    for (const bad of [{ assigneeId: "u" }, { assigneeId: "", version: 1 }, { assigneeId: "u", version: 0 }, { assigneeId: "u", version: 1, to: "x" }]) expect(() => followUpAssignInput.parse(bad)).toThrow();
    expect(followUpTransitionInput.parse({ to: "closed", version: 3 })).toEqual({ to: "closed", version: 3 });
    for (const bad of [{ to: "assigned", version: 1 }, { to: "closed" }, { to: "closed", version: 1, assigneeId: "u" }]) expect(() => followUpTransitionInput.parse(bad)).toThrow();
  });
});
