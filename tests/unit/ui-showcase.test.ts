import { describe, expect, it } from "vitest";
import { uiShowcaseEnabled, uiShowcaseEntries } from "../../src/lib/ui-showcase";
describe("showcase exposure", () => {
  it.each([undefined, "", "0", "1", "true"])("never exposes production fixtures with flag %s", flag => {
    expect(uiShowcaseEnabled("production", flag)).toBe(false);
  });
  it("requires explicit development opt-in", () => {
    expect(uiShowcaseEnabled("development", "1")).toBe(true);
    for (const env of [undefined, "test", "production"]) expect(uiShowcaseEnabled(env, "1")).toBe(false);
    expect(uiShowcaseEnabled("development", undefined)).toBe(false);
  });
  it("registers unique examples with real consumer references", () => {
    expect(new Set(uiShowcaseEntries.map(entry => entry.id)).size).toBe(uiShowcaseEntries.length);
    for (const entry of uiShowcaseEntries) { expect(entry.sources.length).toBeGreaterThan(0); expect(entry.consumers.length).toBeGreaterThanOrEqual(2); }
  });
});
