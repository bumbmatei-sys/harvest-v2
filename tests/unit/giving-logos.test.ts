import { readFileSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GivingMark, givingGenericKinds, givingKindMarks, givingLogos } from "../../src/components/giving/giving-logos";
import { givingBrandFill, givingBrandHex, themeRegistry } from "../../src/lib/theme-registry";
import { givingKinds } from "../../src/lib/ways-to-give";
import { givingLogoProvenance } from "../../src/lib/ui-provenance";

const logoKinds = Object.keys(givingLogos), genericKinds = Object.keys(givingGenericKinds);
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
/** The fill for one mode out of a `light-dark(a, b)` value (or the single colour). */
const fillFor = (value: string, mode: "light" | "dark") => { const m = /^light-dark\(([^,]+), ([^)]+)\)$/.exec(value); return m ? m[mode === "light" ? 1 : 2] : value; };

describe("Ways to give logos", () => {
  it("gives every kind except bank transfer either a logo or an explicit generic fallback, never both", () => {
    for (const kind of givingKinds) expect(logoKinds.includes(kind) !== genericKinds.includes(kind), kind).toBe(true);
    expect([...logoKinds, ...genericKinds].sort()).toEqual([...givingKinds].sort());
    expect(genericKinds).toContain("bank_transfer");
    expect(logoKinds).not.toContain("bank_transfer");
    for (const kind of genericKinds) expect(givingGenericKinds[kind as keyof typeof givingGenericKinds].length, kind).toBeGreaterThan(10);
  });
  it("has a non-empty SVG path, a Simple Icons slug and a six-digit brand colour for every logo", () => {
    for (const [kind, logo] of Object.entries(givingLogos)) {
      expect(logo.path.length, kind).toBeGreaterThan(50);
      expect(logo.path, kind).toMatch(/^M[0-9MmLlHhVvCcSsQqTtAaZz .,-]+$/);
      expect(logo.slug, kind).toMatch(/^[a-z0-9]+$/);
      expect(givingBrandHex[kind], kind).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
  it("uses the brand colour only where it meets 3:1 against the chip in that mode, in every theme, else the chip's text colour", () => {
    expect(Object.keys(givingBrandFill).sort()).toEqual([...logoKinds].sort());
    expect(Object.keys(givingBrandHex).sort()).toEqual([...logoKinds].sort());
    for (const kind of logoKinds) for (const mode of ["light", "dark"] as const) {
      const chips = Object.values(themeRegistry).map((theme) => (theme[mode] as Record<string, string>)["--surface-sunken"]);
      const passes = chips.every((chip) => contrast(givingBrandHex[kind], chip) >= 3);
      expect(fillFor(givingBrandFill[kind], mode), `${kind} ${mode}`).toBe(passes ? givingBrandHex[kind] : "currentColor");
    }
  });
  it("renders a labelled image for a logo and for a generic icon, and decorative marks for option lists", () => {
    const paypal = renderToStaticMarkup(h(GivingMark, { kind: "paypal", label: "PayPal" }));
    expect(paypal).toContain('role="img"'); expect(paypal).toContain('aria-label="PayPal"'); expect(paypal).toContain("<title>PayPal</title>");
    expect(paypal).toContain(`d="${givingLogos.paypal.path}"`); expect(paypal).toContain('data-giving-logo="paypal"');
    const bank = renderToStaticMarkup(h(GivingMark, { kind: "bank_transfer", label: "Bank transfer" }));
    expect(bank).toContain('data-giving-generic="bank_transfer"'); expect(bank).toContain('aria-label="Bank transfer"'); expect(bank).not.toContain("data-giving-logo");
    const option = renderToStaticMarkup(h(givingKindMarks.venmo, { className: "size-4" }));
    expect(option).toContain('aria-hidden="true"'); expect(option).not.toContain('role="img"');
  });
  it("records the provenance: source, version, licence, brands taken and left generic, and the temporary kinds", () => {
    expect(givingLogoProvenance).toMatchObject({ source: "simple-icons", version: "16.38.1", license: "CC0-1.0", requestedBy: "founder", requestedOn: "2026-11-26" });
    expect([...givingLogoProvenance.logos].sort()).toEqual([...logoKinds].sort());
    expect(givingLogoProvenance.generic.map((g) => g.kind).sort()).toEqual([...genericKinds].sort());
    expect([...givingLogoProvenance.temporary].sort()).toEqual(["donorbox", "gofundme"]);
    const doc = readFileSync("docs/ui-sources.md", "utf8");
    expect(doc).toContain("## Ways to give logos (26 Nov 2026)");
    expect(doc).toContain("simple-icons@16.38.1"); expect(doc).toContain("CC0-1.0");
    expect(readFileSync("src/components/giving/giving-logos.tsx", "utf8")).not.toMatch(/from "simple-icons"/);
    expect(JSON.parse(readFileSync("package.json", "utf8")).dependencies["simple-icons"]).toBeUndefined();
  });
});
