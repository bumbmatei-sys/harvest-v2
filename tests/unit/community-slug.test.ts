import { expect, it } from "vitest";
import { communitySlugPattern, nextSlug, slugFollowsName, suggestSlug } from "../../src/lib/community-editor";

it("suggests an address from the title", () => {
  expect(suggestSlug("Grace Bible Study")).toBe("grace-bible-study");
  expect(suggestSlug("  Café — Évening  ")).toBe("cafe-evening");
  expect(suggestSlug("!!")).toBe("");
});
it("follows the title only for a draft whose address still matches it", () => {
  expect(slugFollowsName({ slug: "grace-study", name: "Grace Study", status: "draft" })).toBe(true);
  expect(slugFollowsName({ slug: "prayer", name: "Grace Study", status: "draft" })).toBe(false);
  expect(slugFollowsName({ slug: "grace-study", name: "Grace Study", status: "published" })).toBe(false);
});
it("changes the address with the title only while following, and only to a valid address", () => {
  expect(nextSlug("grace-study", "Evening Circle", true)).toBe("evening-circle");
  expect(nextSlug("prayer", "Evening Circle", false)).toBe("prayer");
  expect(nextSlug("grace-study", "A", true)).toBe("grace-study");
  expect(nextSlug("grace-study", "", true)).toBe("grace-study");
  expect(communitySlugPattern.test("evening-circle")).toBe(true);
  expect(communitySlugPattern.test("-bad-")).toBe(false);
});
