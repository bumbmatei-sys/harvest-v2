import { describe, expect, it } from "vitest";
import { filterMembers, isStaffRole, memberInitials, memberStatusTone, statusTabs } from "../../src/lib/community-members";

describe("community member list helpers (Kit PR 7)", () => {
  it("builds one or two capital initials and falls back to a question mark", () => {
    expect(memberInitials("Grace Hopper")).toBe("GH");
    expect(memberInitials("  maria  de la cruz ")).toBe("MC");
    expect(memberInitials("Ada")).toBe("A");
    expect(memberInitials("   ")).toBe("?");
    expect(memberInitials("")).toBe("?");
    expect(memberInitials("😀 Smile")).toBe("😀S");
  });
  it("filters by name, case-insensitively, and keeps everyone for an empty query", () => {
    const members = [{ name: "Rebecca" }, { name: "Nathan" }, { name: "" }];
    expect(filterMembers(members, "reb")).toEqual([{ name: "Rebecca" }]);
    expect(filterMembers(members, "  ")).toHaveLength(3);
    expect(filterMembers(members, "zz")).toEqual([]);
    expect(filterMembers(members, "")).not.toBe(members);
  });
  it("lists status tabs with counts, all first, only for statuses that exist", () => {
    expect(statusTabs([{ status: "active" }, { status: "banned" }, { status: "active" }, {}])).toEqual([{ value: "all", count: 4 }, { value: "active", count: 2 }, { value: "banned", count: 1 }]);
    expect(statusTabs([])).toEqual([{ value: "all", count: 0 }]);
  });
  it("maps statuses to tones and recognises staff roles", () => {
    expect(memberStatusTone("active")).toBe("success");
    expect(memberStatusTone("banned")).toBe("danger");
    expect(memberStatusTone("pending")).toBe("pending");
    expect(memberStatusTone("unknown")).toBe("neutral");
    expect(["owner", "admin", "moderator"].every(isStaffRole)).toBe(true);
    expect(["member", "contributor", "viewer"].some(isStaffRole)).toBe(false);
  });
});
