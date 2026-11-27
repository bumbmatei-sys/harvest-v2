import { describe, expect, it } from "vitest";
import { centsToInput, formatMoney, landingBody, landingInput, saleProblem, toCents } from "../../src/lib/catalog-landing";

const now = Date.parse("2026-11-27T12:00:00Z");
const price = { cents: 2900, currency: "USD" as const };
const sale = (cents: number, start: string, end: string) => ({ cents, startsAt: start, endsAt: end });

describe("landing sale rules", () => {
  it("needs a price, a lower amount and an end after the start and in the future", () => {
    expect(saleProblem({ price: null, sale: null }, now)).toBeNull();
    expect(saleProblem({ price: null, sale: sale(1900, "2026-11-27T00:00:00Z", "2026-11-29T00:00:00Z") }, now)).toBe("needsPrice");
    expect(saleProblem({ price, sale: sale(2900, "2026-11-27T00:00:00Z", "2026-11-29T00:00:00Z") }, now)).toBe("notLower");
    expect(saleProblem({ price, sale: sale(1900, "2026-11-29T00:00:00Z", "2026-11-28T00:00:00Z") }, now)).toBe("endBeforeStart");
    expect(saleProblem({ price, sale: sale(1900, "2026-11-20T00:00:00Z", "2026-11-26T00:00:00Z") }, now)).toBe("ended");
    expect(saleProblem({ price, sale: sale(1900, "2026-11-27T00:00:00Z", "2026-11-29T00:00:00Z") }, now)).toBeNull();
  });
  it("parses amounts and formats prices", () => {
    expect(toCents("29")).toBe(2900);
    expect(toCents("12.5")).toBe(1250);
    expect(toCents("12,50")).toBe(1250);
    expect(toCents("1.234")).toBeNull();
    expect(toCents("-3")).toBeNull();
    expect(centsToInput(2900)).toBe("29");
    expect(centsToInput(1250)).toBe("12.50");
    expect(formatMoney(2900, "USD")).toBe("$29");
    expect(formatMoney(1250, "EUR")).toBe("€12.50");
  });
  it("refuses unknown keys, control characters and over-long lists", () => {
    expect(landingInput.safeParse({ version: 0, extra: 1 }).success).toBe(false);
    expect(landingInput.safeParse({ version: 0, subtitle: "Line\u0007" }).success).toBe(false);
    expect(landingInput.safeParse({ version: 0, included: Array.from({ length: 13 }, () => "x") }).success).toBe(false);
    expect(landingInput.safeParse({ version: 0, price: { cents: 50, currency: "USD" } }).success).toBe(false);
    expect(landingInput.parse({ version: 0 })).toMatchObject({ subtitle: "", included: [], faq: [], price: null, sale: null });
  });
  it("keeps the long text as sanitised block JSON", () => {
    expect(landingBody(null)).toBeNull();
    expect(landingBody({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] })).toMatchObject({ type: "doc" });
  });
});
