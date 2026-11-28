import { expect, it } from "vitest";
import { landingDefinition, landingJoinCode, sameLandingDefinition, type LandingDefinition } from "../../src/lib/connect-landing";
import { campaignLanding } from "../../src/lib/connect-public";

const base: LandingDefinition = { heading: "Welcome", message: "", cards: [] };
const id = "0b6f1d2e-3c4a-4b5c-8d9e-0f1a2b3c4d5e";

it("accepts one optional lowercase community id and nothing else at the top level", () => {
  expect(landingDefinition.safeParse(base).success).toBe(true);
  expect(landingDefinition.safeParse({ ...base, communityId: id }).success).toBe(true);
  for (const bad of [id.toUpperCase(), "", "x", 7, null]) expect(landingDefinition.safeParse({ ...base, communityId: bad }).success, String(bad)).toBe(false);
  expect(landingDefinition.safeParse({ ...base, communityIds: [id] }).success).toBe(false);
});

it("treats a changed community choice as an unsaved change", () => {
  expect(sameLandingDefinition({ ...base, communityId: id }, { ...base, communityId: id })).toBe(true);
  expect(sameLandingDefinition(base, { ...base, communityId: id })).toBe(false);
});

it("carries only a QR or short code, never another value, to the community join", () => {
  expect(landingJoinCode.safeParse("a".repeat(32)).success).toBe(true);
  expect(landingJoinCode.safeParse("0123456789AB").success).toBe(true);
  for (const bad of ["A".repeat(32), "0123456789ab", "../x", "x@example.invalid", "a".repeat(33)]) expect(landingJoinCode.safeParse(bad).success, bad).toBe(false);
});

it("adds the recommended community to the public landing only when given", () => {
  expect(campaignLanding("en", null, base)).not.toHaveProperty("community");
  expect(campaignLanding("en", null, base, { slug: "grace", name: "Grace", tagline: null }).community).toEqual({ slug: "grace", name: "Grace", tagline: null });
});
