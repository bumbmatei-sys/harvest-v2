import { describe, expect, it } from "vitest";
import { canActOn, communityRank, matchesBannedWord, normaliseBannedWords } from "@/lib/moderation";

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
