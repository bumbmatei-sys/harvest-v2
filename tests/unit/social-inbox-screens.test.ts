import { describe, expect, it } from "vitest";
import { accountProblem, mergeItems, mergeMessages, patchItem, replyReasonKey, slotsProblem, type InboxItem, type ThreadMessage } from "../../src/lib/social/inbox";

const item = (id: string, at: string | null): InboxItem => ({ id, connectionId: "c", kind: "dm", activityAt: at, status: "open", assigneeId: null, starred: false, snoozedUntil: null, version: 1, contactId: null, labelIds: [], readInHarvest: false,
  account: { id: "c", platform: "instagram", displayName: null, state: "available", health: "healthy", capabilityVersion: "v", capabilities: {} as never } });
const msg = (ref: string, at: string | null): ThreadMessage => ({ ref, direction: "incoming", text: ref, at, attachments: [] });

describe("inbox view helpers", () => {
  it("keys rows by Harvest id and orders newest first", () => {
    const merged = mergeItems([item("a", "2026-01-01T10:00:00Z")], [item("b", "2026-01-02T10:00:00Z"), item("a", "2026-01-03T10:00:00Z")]);
    expect(merged.map((row) => row.id)).toEqual(["a", "b"]);
  });
  it("orders messages oldest first and dedupes by reference", () => {
    const merged = mergeMessages([msg("2", "2026-01-02T00:00:00Z")], [msg("1", "2026-01-01T00:00:00Z"), msg("2", "2026-01-02T00:00:00Z"), msg("x", null)]);
    expect(merged.map((row) => row.ref)).toEqual(["1", "2", "x"]);
  });
  it("patches one item and its version", () => {
    expect(patchItem([item("a", null), item("b", null)], "b", 5, { starred: true }).map((row) => [row.version, row.starred])).toEqual([[1, false], [5, true]]);
  });
  it("names an account problem, never an empty inbox", () => {
    expect(accountProblem({ state: "available" })).toBeNull();
    expect(accountProblem({ state: "expired" })).toBe("expired");
    expect(accountProblem({ state: "paused" })).toBe("disabled");
  });
  it("maps reply reasons and falls back to a generic one", () => {
    expect(replyReasonKey("expired_window")).toBe("expired_window");
    expect(replyReasonKey("nope")).toBe("unknown");
  });
  it("applies the server's working-hours rules", () => {
    expect(slotsProblem([{ day: 1, start: "09:00", end: "17:00" }])).toBeNull();
    expect(slotsProblem([{ day: 1, start: "17:00", end: "09:00" }])).toBe("order");
    expect(slotsProblem([{ day: 1, start: "09:00", end: "12:00" }, { day: 1, start: "11:00", end: "13:00" }])).toBe("overlap");
    expect(slotsProblem([{ day: 1, start: "09:00", end: "12:00" }, { day: 2, start: "11:00", end: "13:00" }])).toBeNull();
  });
});
