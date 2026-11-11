import { expect, it } from "vitest";
import { accountProfileInput, statusOf } from "../../src/server/account-profile";

it("derives onboarding status, completed winning over skipped", () => {
  const d = new Date();
  expect(statusOf(null, null)).toBe("pending");
  expect(statusOf(null, d)).toBe("skipped");
  expect(statusOf(d, d)).toBe("completed");
});
it("trims and bounds the profile input and rejects unknown keys", () => {
  expect(accountProfileInput.parse({ name: "  Ana ", locale: null, cityRegion: " Oslo " })).toEqual({ name: "Ana", locale: null, cityRegion: "Oslo" });
  expect(() => accountProfileInput.parse({ name: " ", locale: null, cityRegion: null })).toThrow();
  expect(() => accountProfileInput.parse({ name: "A", locale: null, cityRegion: "" })).toThrow();
  expect(() => accountProfileInput.parse({ name: "A", locale: null, cityRegion: null, religion: "x" })).toThrow();
});
