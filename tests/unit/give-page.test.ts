import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { giveDescriptionInput, givePageInput, giveReservedSlugs, giveSlugPattern, giveSlugProblem, parseGivePublicView, suggestGiveSlug } from "../../src/lib/give-page";

describe("give page rules", () => {
  it("keeps the slug pattern and reserved words in step with the migration", () => {
    const sqlText = readFileSync("drizzle/0124_give_pages.sql", "utf8");
    const check = sqlText.match(/CONSTRAINT "fundraising_page_slug" CHECK \((.*)\),\n/)?.[1] ?? "";
    expect(check).toContain(`'${giveSlugPattern.source}'`);
    const listed = [...(check.match(/not in \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed).toEqual([...giveReservedSlugs]);
    expect(sqlText).toContain(`p_slug !~ '${giveSlugPattern.source}'`);
  });

  it("validates slugs", () => {
    expect(giveSlugProblem("christmas-outreach")).toBeNull();
    expect(giveSlugProblem("abc")).toBeNull();
    expect(giveSlugProblem("ab")).toBe("format");
    expect(giveSlugProblem("a".repeat(48))).toBeNull();
    expect(giveSlugProblem("a".repeat(49))).toBe("format");
    expect(giveSlugProblem("donate")).toBe("reserved");
    expect(givePageInput.parse({ slug: " Christmas-Outreach ", showAmount: true })).toEqual({ slug: "christmas-outreach", description: null, showAmount: true });
    expect(() => givePageInput.parse({ slug: "give", showAmount: true })).toThrow();
    expect(() => givePageInput.parse({ slug: "ok-slug", showAmount: true, extra: 1 })).toThrow();
  });

  it("suggests a slug from the title", () => {
    expect(suggestGiveSlug("Christmas Outreach 2026!")).toBe("christmas-outreach-2026");
    expect(suggestGiveSlug("Mission à São Paulo")).toBe("mission-a-sao-paulo");
    expect(suggestGiveSlug("!!")).toBe("");
    expect(suggestGiveSlug("x".repeat(60)).length).toBe(48);
  });

  it("normalises descriptions to plain text with line breaks", () => {
    expect(giveDescriptionInput.parse("  One\r\nTwo\rThree  ")).toBe("One\nTwo\nThree");
    expect(giveDescriptionInput.parse("   ")).toBeNull();
    expect(() => giveDescriptionInput.parse("bad\u0000")).toThrow();
    expect(() => giveDescriptionInput.parse("x".repeat(5001))).toThrow();
  });

  it("accepts only the allow-listed public shape", () => {
    const view = { slug: "abc", title: "T", description: null, ministry: "M", hasCover: false, amount: { currency: "USD", goalCents: "100", raisedCents: null } };
    expect(parseGivePublicView(view)).toEqual(view);
    expect(parseGivePublicView({ ...view, donors: [] })).toBeNull();
    expect(parseGivePublicView({ ...view, amount: { ...view.amount, pledgedCents: "1" } })).toBeNull();
    expect(parseGivePublicView(null)).toBeNull();
  });
});
