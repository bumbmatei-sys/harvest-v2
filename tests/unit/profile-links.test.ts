import { describe, expect, it } from "vitest";
import { cleanLinks, hasLinkIssues, isDirty, linkIssues, moveLink, normalizeDraft, urlIssue, type ProfileDraft } from "../../src/lib/profile-links";

const empty: ProfileDraft = { displayName: "", bio: "", language: "", links: [], visibility: "members" };

describe("profile link address rules (mirror of the server)", () => {
  it.each([
    ["https://example.org", null],
    ["  https://example.org/path?x=1#top  ", null],
    ["https://sub.example.org:8443/a", null],
    ["", "urlRequired"],
    ["   ", "urlRequired"],
    ["http://example.org", "urlNotHttps"],
    ["example.org", "urlNotHttps"],
    ["javascript:alert(1)", "urlNotHttps"],
    ["https://user:pass@example.org", "urlInvalid"],
    ["https://example.org@evil.test/", "urlInvalid"],
    ["https://exa mple.org", "urlInvalid"],
    ["https://example.org\\evil", "urlInvalid"],
    ["https://", "urlInvalid"],
    ["https:///path", "urlInvalid"],
    [`https://example.org/${"a".repeat(2048)}`, "urlInvalid"],
  ] as const)("%s", (value, expected) => expect(urlIssue(value)).toBe(expected));
});

describe("link rows", () => {
  it("drops blank rows and trims the rest", () => {
    expect(cleanLinks([{ label: " Site ", url: " https://a.org " }, { label: " ", url: "" }])).toEqual([{ label: "Site", url: "https://a.org" }]);
  });
  it("reports each problem on its row and ignores blank rows", () => {
    const issues = linkIssues([{ label: "", url: "https://a.org" }, { label: "x", url: "http://a.org" }, { label: "", url: "" }, { label: "ok", url: "https://b.org" }, { label: "y".repeat(41), url: "https://c.org" }]);
    expect(issues).toEqual([{ label: "labelRequired" }, { url: "urlNotHttps" }, {}, {}, { label: "labelTooLong" }]);
    expect(hasLinkIssues(issues)).toBe(true);
    expect(hasLinkIssues(linkIssues([{ label: "ok", url: "https://b.org" }]))).toBe(false);
  });
  it("reorders without mutating and ignores moves off either end", () => {
    const rows = ["a", "b", "c"];
    expect(moveLink(rows, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveLink(rows, 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveLink(rows, 0, -1)).toEqual(rows);
    expect(moveLink(rows, 2, 1)).toEqual(rows);
    expect(rows).toEqual(["a", "b", "c"]);
  });
});

describe("dirty state", () => {
  it("ignores whitespace and blank link rows, notices real edits, reorder and visibility", () => {
    expect(isDirty(empty, { ...empty, displayName: "  ", links: [{ label: "", url: "" }] })).toBe(false);
    expect(isDirty(empty, { ...empty, displayName: "Dan" })).toBe(true);
    expect(isDirty(empty, { ...empty, visibility: "private" })).toBe(true);
    const two = { ...empty, links: [{ label: "A", url: "https://a.org" }, { label: "B", url: "https://b.org" }] };
    expect(isDirty(two, { ...two, links: moveLink(two.links, 0, 1) })).toBe(true);
    expect(isDirty(two, { ...two, links: [...two.links] })).toBe(false);
  });
  it("normalizes to what the server stores", () => {
    expect(normalizeDraft({ ...empty, displayName: " Dan ", bio: "", language: " ", links: [{ label: " L ", url: "https://a.org" }] }))
      .toEqual({ displayName: "Dan", bio: null, language: null, links: [{ label: "L", url: "https://a.org" }], visibility: "members" });
  });
});
