import { describe, expect, it } from "vitest";
import { resolveFromLocales, resolveLocale } from "../../src/i18n/locale";

describe("locale resolution", () => {
  it("prioritizes profile, then cookie, then weighted browser languages", () => {
    const available = ["en", "fr", "de"] as const;
    const resolve = (user: string | null, cookie: string | null, header: string | null) => resolveFromLocales(user, cookie, header, available, "en");
    expect(resolve("de", "fr", "en")).toBe("de");
    expect(resolve("invalid", "fr", "de")).toBe("fr");
    expect(resolve(null, null, "fr;q=0.2, de-DE;q=0.9")).toBe("de");
    expect(resolve(null, null, "de;q=0, fr;q=0.5")).toBe("fr");
    expect(resolve(null, null, "de;q=invalid, fr;q=0.5")).toBe("fr");
  });
  it.each([
    ["en", "invalid", "fr", "en"],
    [null, "en", "fr", "en"],
    [null, null, "fr, en-US;q=0.8", "en"],
    [null, null, "fr, en;q=0", "en"],
    ["unsupported", "invalid", null, "en"],
    [null, null, null, "en"],
  ])("resolves user %s, cookie %s, and browser %s", (user, cookie, header, expected) => {
    expect(resolveLocale(user, cookie, header)).toBe(expected);
  });
});
