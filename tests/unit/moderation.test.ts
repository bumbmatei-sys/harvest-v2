import { describe, expect, it } from "vitest";
import { appealDecisions, canActOn, canAppeal, canDecideAppeal, communityRank, matchesBannedWord, moderationLimits as limits, normaliseBannedWords, revisionCap, shouldRecordRevision, validReason } from "@/lib/moderation";

// C12b: warnings, appeals, edit history.
describe("validReason", () => {
  it("trims and enforces the length range", () => {
    expect(validReason("  Please be kind.  ", limits.warning)).toBe("Please be kind.");
    expect(validReason("   ", limits.warning)).toBeNull();
    expect(validReason("x".repeat(500), limits.warning)).not.toBeNull();
    expect(validReason("x".repeat(501), limits.warning)).toBeNull();
    expect(validReason("x".repeat(1000), limits.appeal)).not.toBeNull();
    expect(validReason("x".repeat(1001), limits.appeal)).toBeNull();
  });
});

describe("appeals", () => {
  it("lets any host decline but only owners and admins approve", () => {
    expect(appealDecisions).toEqual(["approve", "decline"]);
    for (const role of ["owner", "admin", "moderator"]) expect(canDecideAppeal(role, "decline")).toBe(true);
    for (const role of ["owner", "admin"]) expect(canDecideAppeal(role, "approve")).toBe(true);
    for (const role of ["moderator", "contributor", "member"]) expect(canDecideAppeal(role, "approve")).toBe(false);
    for (const role of ["contributor", "member"]) expect(canDecideAppeal(role, "decline")).toBe(false);
  });
  it("allows one appeal per ban", () => {
    const banned = new Date("2026-11-01T10:00:00Z");
    expect(canAppeal({ banned: false, bannedAt: banned, lastAppealAt: null })).toBe(false);
    expect(canAppeal({ banned: true, bannedAt: banned, lastAppealAt: null })).toBe(true);
    expect(canAppeal({ banned: true, bannedAt: banned, lastAppealAt: new Date("2026-11-02T10:00:00Z") })).toBe(false);
    expect(canAppeal({ banned: true, bannedAt: banned, lastAppealAt: new Date("2026-10-20T10:00:00Z") })).toBe(true);
  });
});

describe("shouldRecordRevision", () => {
  it("records only real changes", () => {
    const a = { title: "T", body: { type: "doc" }, bodyText: "Hi" };
    expect(shouldRecordRevision(a, { ...a, body: { type: "doc" } })).toBe(false);
    expect(shouldRecordRevision(a, { ...a, title: "T2" })).toBe(true);
    expect(shouldRecordRevision(a, { ...a, bodyText: "Hello" })).toBe(true);
    expect(shouldRecordRevision(a, { ...a, body: { type: "doc", content: [] } })).toBe(true);
    expect(revisionCap).toBe(50);
  });
});

describe("canActOn", () => {
  it("lets higher ranks act on lower ones only", () => {
    expect(canActOn("owner", "admin")).toBe(true);
    expect(canActOn("admin", "moderator")).toBe(true);
    expect(canActOn("admin", "member")).toBe(true);
    expect(canActOn("moderator", "member")).toBe(true);
    expect(canActOn("moderator", "contributor")).toBe(true);
    expect(canActOn("moderator", "moderator")).toBe(false);
    expect(canActOn("admin", "admin")).toBe(false);
    expect(canActOn("member", "member")).toBe(false);
    expect(canActOn("contributor", "member")).toBe(false);
  });
  it("never acts on the owner or on oneself", () => {
    expect(canActOn("owner", "owner")).toBe(false);
    expect(canActOn("admin", "owner")).toBe(false);
    expect(canActOn("owner", "member", true)).toBe(false);
  });
  it("ranks roles", () => { expect(["owner", "admin", "moderator", "contributor", "member"].map(communityRank)).toEqual([3, 2, 1, 0, 0]); });
});

describe("banned words", () => {
  it("normalises, de-duplicates and caps", () => {
    expect(normaliseBannedWords(["  Spam ", "spam", "", "Buy  Now"])).toEqual(["spam", "buy now"]);
    expect(() => normaliseBannedWords(["x".repeat(41)])).toThrow();
    expect(() => normaliseBannedWords(Array.from({ length: 101 }, (_, i) => `w${i}`))).toThrow();
    expect(normaliseBannedWords(Array.from({ length: 100 }, (_, i) => `w${i}`))).toHaveLength(100);
  });
  it("matches whole words only, case-insensitively", () => {
    expect(matchesBannedWord("This is SPAM!", ["spam"])).toBe(true);
    expect(matchesBannedWord("spam", ["spam"])).toBe(true);
    expect(matchesBannedWord("(spam)", ["spam"])).toBe(true);
    expect(matchesBannedWord("spammer here", ["spam"])).toBe(false);
    expect(matchesBannedWord("antispam", ["spam"])).toBe(false);
    expect(matchesBannedWord("please buy now today", ["buy now"])).toBe(true);
    expect(matchesBannedWord("nothing here", [])).toBe(false);
    expect(matchesBannedWord("a.b", ["a.b"])).toBe(true);
    expect(matchesBannedWord("axb", ["a.b"])).toBe(false);
  });
});
