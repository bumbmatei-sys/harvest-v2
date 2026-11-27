import { expect, it } from "vitest";
import { communityAddressLocked, communitySlugPattern, nextSlug, slugFollowsName, suggestSlug } from "../../src/lib/community-editor";

it("suggests an address from the title", () => {
  expect(suggestSlug("Grace Bible Study")).toBe("grace-bible-study");
  expect(suggestSlug("  Café — Évening  ")).toBe("cafe-evening");
  expect(suggestSlug("!!")).toBe("");
});
it("follows the title only for a draft whose address still matches it", () => {
  expect(slugFollowsName({ slug: "grace-study", name: "Grace Study", status: "draft" })).toBe(true);
  expect(slugFollowsName({ slug: "prayer", name: "Grace Study", status: "draft" })).toBe(false);
  expect(slugFollowsName({ slug: "grace-study", name: "Grace Study", status: "published" })).toBe(false);
  // Once ever published (0128 marker), an unpublished draft no longer follows its title.
  expect(slugFollowsName({ slug: "grace-study", name: "Grace Study", status: "draft", firstPublishedAt: "2026-11-01T00:00:00.000Z" })).toBe(false);
});
it("locks the address once the community has ever been published, unpublished since or not", () => {
  expect(communityAddressLocked({ status: "draft", firstPublishedAt: null })).toBe(false);
  expect(communityAddressLocked({ status: "draft" })).toBe(false);
  expect(communityAddressLocked({ status: "published", firstPublishedAt: null })).toBe(true);
  expect(communityAddressLocked({ status: "draft", firstPublishedAt: "2026-11-01T00:00:00.000Z" })).toBe(true);
  expect(communityAddressLocked({ status: "archived", firstPublishedAt: new Date() })).toBe(true);
});
it("changes the address with the title only while following, and only to a valid address", () => {
  expect(nextSlug("grace-study", "Evening Circle", true)).toBe("evening-circle");
  expect(nextSlug("prayer", "Evening Circle", false)).toBe("prayer");
  expect(nextSlug("grace-study", "A", true)).toBe("grace-study");
  expect(nextSlug("grace-study", "", true)).toBe("grace-study");
  expect(communitySlugPattern.test("evening-circle")).toBe(true);
  expect(communitySlugPattern.test("-bad-")).toBe(false);
});
