import { describe, expect, it } from "vitest";
import { decodeCursor, dueBucket, encodeCursor, instantToZoned, isOverdue, noteInput, parseTaskQuery, taskInput, taskPatch, taskQueryParams, zonedToInstant } from "../../src/lib/crm-tasks";
import { can } from "../../src/server/permissions";

describe("CRM-05 shared model", () => {
  it("converts Berlin wall-clock times to instants and back, across both DST changes", () => {
    expect(zonedToInstant("2026-01-15T09:00")?.toISOString()).toBe("2026-01-15T08:00:00.000Z");
    expect(zonedToInstant("2026-07-15T09:00")?.toISOString()).toBe("2026-07-15T07:00:00.000Z");
    expect(instantToZoned(new Date("2026-03-29T01:30:00Z"))).toBe("2026-03-29T03:30");
    // 02:30 on the spring-forward night does not exist in Berlin.
    expect(zonedToInstant("2026-03-29T02:30")).toBeNull();
    expect(zonedToInstant("2026-13-01T00:00")).toBeNull();
  });
  it("flags overdue only for open tasks and buckets by the Berlin day", () => {
    const now = new Date("2026-11-06T21:30:00Z"); // 22:30 in Berlin
    expect(isOverdue("open", "2026-11-06T21:00:00Z", now)).toBe(true);
    expect(isOverdue("done", "2026-11-06T21:00:00Z", now)).toBe(false);
    expect(dueBucket("open", "2026-11-06T22:30:00Z", now)).toBe("today"); // 23:30 Berlin
    expect(dueBucket("open", "2026-11-06T23:30:00Z", now)).toBe("upcoming"); // 00:30 next Berlin day
    expect(dueBucket("open", null, now)).toBe("none");
    expect(dueBucket("open", "2026-11-05T10:00:00Z", now)).toBe("overdue");
  });
  it("validates tasks: title required, small enums, member-shaped ids, due as Berlin local or ISO", () => {
    expect(taskInput.safeParse({ title: "  " }).success).toBe(false);
    expect(taskInput.parse({ title: " Call ", dueAt: "2026-01-15T09:00" })).toMatchObject({ title: "Call", priority: "none", body: "", dueAt: new Date("2026-01-15T08:00:00Z") });
    expect(taskInput.parse({ title: "x", dueAt: "" }).dueAt).toBeNull();
    for (const bad of [{ title: "x", priority: "urgent" }, { title: "x", dueAt: "tomorrow" }, { title: "x", contactId: "nope" }, { title: "x", body: "y".repeat(5001) }]) expect(taskInput.safeParse(bad).success).toBe(false);
    expect(taskPatch.safeParse({ status: "cancelled", version: 1 }).success).toBe(false);
  });
  it("validates notes: one target, non-empty, at most 10,000 characters, trailing whitespace trimmed", () => {
    expect(noteInput.parse({ target: "person", targetId: "00000000-0000-4000-8000-000000000001", body: "Line 1\n  Line 2  \n" }).body).toBe("Line 1\n  Line 2");
    expect(noteInput.safeParse({ target: "person", targetId: "00000000-0000-4000-8000-000000000001", body: "\n \n" }).success).toBe(false);
    expect(noteInput.safeParse({ target: "task", targetId: "00000000-0000-4000-8000-000000000001", body: "x" }).success).toBe(false);
    expect(noteInput.safeParse({ target: "deal", targetId: "00000000-0000-4000-8000-000000000001", body: "x".repeat(10_001) }).success).toBe(false);
  });
  it("parses task list URL state with 'me' and open as defaults", () => {
    const parsed = parseTaskQuery({ assignee: "any", due: "overdue", sort: "-priority", page: "3" });
    expect(parsed.success && parsed.data).toMatchObject({ assignee: "any", status: "open", due: "overdue", sort: "-priority", page: 3 });
    expect(parsed.success && taskQueryParams(parsed.data).toString()).toBe("assignee=any&due=overdue&sort=-priority&page=3");
    for (const raw of [{ status: "cancelled" }, { due: "soon" }, { sort: "drop" }]) expect(parseTaskQuery(raw).success).toBe(false);
  });
  it("round-trips microsecond timeline cursors and rejects anything else", () => {
    const cursor = encodeCursor("2026-11-06T10:00:00.123456Z", "00000000-0000-4000-8000-000000000001");
    expect(decodeCursor(cursor)).toEqual({ at: "2026-11-06T10:00:00.123456Z", id: "00000000-0000-4000-8000-000000000001" });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("2026-11-06T10:00:00.123Z_x")).toBeUndefined();
  });
  it("lets every role read tasks and notes and only owners, admins and members write them", () => {
    for (const permission of ["tasks:read", "notes:read"] as const) expect(["owner", "admin", "member", "viewer"].map((role) => can(role, permission))).toEqual([true, true, true, true]);
    for (const permission of ["tasks:write", "notes:write"] as const) expect(["owner", "admin", "member", "viewer"].map((role) => can(role, permission))).toEqual([true, true, true, false]);
    expect(can("unknown", "tasks:read")).toBe(false);
  });
});
