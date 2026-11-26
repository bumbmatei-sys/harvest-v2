import { describe, expect, it } from "vitest";
import { activeFilterCount, categoryIcons, filtersToParams, hasAnyFilter, languageName, parseFilters, publicHref, reviewTone } from "../../src/lib/discover-ui";
import { discoverCategories, discoverTypes, reviewStates } from "../../src/lib/discover-taxonomy";
import { parseSearch } from "../../src/server/discover/public";

describe("discover screen helpers", () => {
  it("parses the page URL leniently: unknown or malformed values are dropped, not an error", () => {
    expect(parseFilters({})).toEqual({ sort: "relevance" });
    expect(parseFilters({ q: "  grace  ", type: "course", category: "prayer", language: "es", free: "1", sort: "newest" })).toEqual({ q: "grace", type: "course", category: "prayer", language: "es", free: true, sort: "newest" });
    expect(parseFilters({ type: "video", category: "nope", language: "en-US", free: "yes", sort: "hot" })).toEqual({ sort: "relevance" });
    expect(parseFilters({ free: "0" })).toMatchObject({ free: false });
    expect(parseFilters({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parseFilters({ type: ["course", "product"] })).toMatchObject({ type: "course" });
  });
  it("builds a query string the server accepts, with the defaults left out", () => {
    expect(filtersToParams({ sort: "relevance" }).toString()).toBe("");
    const full = filtersToParams({ q: "bible study", type: "community", category: "bible_study", language: "en", free: true, sort: "name" }, "MjQ");
    const parsed = parseSearch(full);
    expect(parsed).toMatchObject({ q: "bible study", type: "community", category: "bible_study", language: "en", free: true, sort: "name", cursor: "MjQ" });
    expect(parseSearch(filtersToParams({ free: false, sort: "newest" }))).toMatchObject({ free: false, sort: "newest" });
  });
  it("round-trips every filter through the URL", () => {
    for (const type of discoverTypes) for (const category of discoverCategories) {
      const filters = { type, category, sort: "relevance" as const };
      expect(parseFilters(Object.fromEntries(filtersToParams(filters)))).toEqual(filters);
    }
  });
  it("counts the filters behind the popover badge, not the search, type or sort", () => {
    expect(activeFilterCount({ sort: "name", q: "a", type: "course" })).toBe(0);
    expect(activeFilterCount({ sort: "relevance", category: "youth", language: "en", free: true })).toBe(3);
    expect(hasAnyFilter({ sort: "name" })).toBe(false);
    expect(hasAnyFilter({ sort: "relevance", q: "a" })).toBe(true);
  });
  it("links each type to its public page", () => {
    expect(publicHref({ type: "community", slug: "grace-study" })).toBe("/communities/grace-study");
    expect(publicHref({ type: "course", slug: "grace-study" })).toBe("/courses/grace-study");
    expect(publicHref({ type: "product", slug: "grace-study" })).toBe("/products/grace-study");
  });
  it("has an icon for every category, a tone for every review state and names languages", () => {
    for (const key of discoverCategories) expect(categoryIcons[key], key).toBeDefined();
    expect(reviewStates.map((state) => reviewTone(state))).toEqual(["neutral", "pending", "success", "danger", "warning"]);
    expect(reviewTone("something-new")).toBe("neutral");
    expect(languageName("es")).toBe("Spanish");
    expect(languageName("zz-not-a-code!")).toBeTruthy();
  });
});
