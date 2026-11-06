import { describe, expect, it } from "vitest";
import { getPublicLanding, getStarterResource, previewPublicCode, starterResources } from "../../src/lib/connect-public";

describe("Connect public presentation boundary", () => {
  it("resolves only the exact published opaque preview code", () => {
    expect(previewPublicCode).toMatch(/^[a-f0-9]{32}$/);
    expect(getPublicLanding(previewPublicCode)).toEqual({
      version: 1, source: "starter-preview", publication: "published",
      publicCode: previewPublicCode, locale: "en", resourceIds: starterResources.map(({ id }) => id),
    });
    for (const code of ["1", "", "draft", "__proto__", previewPublicCode.toUpperCase(), `${previewPublicCode}1`, "0".repeat(32)]) {
      expect(getPublicLanding(code)).toBeUndefined();
    }
  });

  it("allows only the curated resource ids, without arbitrary property lookup", () => {
    for (const { id } of starterResources) expect(getStarterResource(id)?.id).toBe(id);
    for (const id of ["__proto__", "constructor", "private", "1", "../common-questions"]) expect(getStarterResource(id)).toBeUndefined();
    expect(new Set(starterResources.map(({ id }) => id)).size).toBe(starterResources.length);
  });
});
