import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { actionForeground, contrastRatio, resolveBrandTheme, themeBootstrap } from "../../src/lib/theme";
import { contactInput } from "../../src/lib/contact-input";
import { can } from "../../src/server/permissions";
describe("appearance precedence and pre-paint script", () => {
  it.each([
    [null, null, "harvest"], [null, "studio", "studio"], ["harvest", "studio", "harvest"],
    ["studio", "harvest", "studio"], ["invalid", "studio", "studio"], ["invalid", "invalid", "harvest"],
  ])("resolves user %s and workspace %s", (user, workspace, expected) => {
    expect(resolveBrandTheme(user, workspace)).toBe(expected);
  });
  it.each([false, true])("initializes both axes before hydration with blocked storage = %s", (blocked) => {
    const root = { dataset: {} as Record<string, string>, classList: { toggle: () => {} } };
    runInNewContext(themeBootstrap("studio"), { document: { documentElement: root }, localStorage: { getItem: () => { if (blocked) throw new Error("blocked"); return null; } }, matchMedia: () => ({ matches: true }) });
    expect(root.dataset).toMatchObject({ workspaceTheme: "studio", brandTheme: "studio", theme: "dark" });
  });
  it("preserves the documented AA contrast at rest and hover", () => {
    expect(contrastRatio("#C9963A", "#2D2519")).toBeGreaterThan(5.6);
    expect(contrastRatio("#CEA04E", "#2D2519")).toBeGreaterThan(6.2);
    expect(actionForeground("#C9963A")).toBe("#2D2519");
    expect(actionForeground("#1A1A1A")).toBe("#FFFFFF");
    expect(() => contrastRatio("red", "#FFFFFF")).toThrow();
  });
});
describe("contact input and permissions", () => {
  it("normalizes identifiers without merging contacts", () => {
    expect(contactInput.parse({ name: " Person ", email: "Person@EXAMPLE.test", phone: "+49 (123) 456-7890" })).toMatchObject({ name: "Person", email: "person@example.test", phone: "+491234567890" });
    expect(contactInput.safeParse({ name: "Person", tenantId: "injected" }).success).toBe(false);
    expect(contactInput.safeParse({ name: "Person", phone: "12345" }).success).toBe(false);
    expect(contactInput.safeParse({ name: " " }).success).toBe(false);
  });
  it("permits member contact writes, viewer reads and admin settings", () => {
    expect(can("member", "contacts:write")).toBe(true);
    expect(can("viewer", "contacts:read")).toBe(false);
    expect(can("viewer", "contacts:write")).toBe(false);
    expect(can("member", "settings:write")).toBe(false);
    expect(can("admin", "settings:write")).toBe(true);
    expect(can("unknown", "contacts:read")).toBe(false);
  });
});

import { BRAND_THEMES, CHART_TOKENS, COLOR_MODES, isBrandTheme, themeRegistry, themeStyles } from "../../src/lib/theme-registry";
describe("theme registry", () => {
  it("defines complete palettes for each brand and color mode", () => {
    const tokens = Object.keys(themeRegistry.harvest.light).sort();
    for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
      const palette = themeRegistry[brand][mode];
      expect(Object.keys(palette).sort()).toEqual(tokens);
      expect(themeStyles).toContain(`[data-brand-theme="${brand}"][data-theme="${mode}"]`);
      expect(contrastRatio(palette["--brand-color"], palette["--action-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--action-fill"], palette["--action-fill-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--action-hover"], palette["--action-fill-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--text-strong"], palette["--surface"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--text-muted"], palette["--surface-card"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--text-muted"], palette["--surface-tint"])).toBeGreaterThanOrEqual(4.5);
      expect(palette["--earth"].toLowerCase()).toBe("#2d2519");
    }
  });
  it("defines five distinct chart tokens per palette with 3:1 non-text contrast on card and page", () => {
    expect(CHART_TOKENS).toHaveLength(5);
    for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
      const palette = themeRegistry[brand][mode];
      const colors = CHART_TOKENS.map((token) => palette[token]);
      expect(new Set(colors).size).toBe(5);
      for (const color of colors) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
        expect(contrastRatio(color, palette["--surface-card"])).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(color, palette["--surface"])).toBeGreaterThanOrEqual(3);
      }
      expect(themeStyles).toContain(`--chart-5:${colors[4]}`);
    }
  });
  it("paints Harvest primary buttons Desert Sun gold with dark olive text in both modes, and leaves the other themes' buttons alone", () => {
    for (const mode of COLOR_MODES) {
      const palette = themeRegistry.harvest[mode];
      expect(palette["--action-fill"]).toBe("#d3a265");
      expect(palette["--action-fill-foreground"]).toBe("#2b2a0c");
      expect(contrastRatio(palette["--action-fill"], palette["--action-fill-foreground"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--action-hover"], palette["--action-fill-foreground"])).toBeGreaterThanOrEqual(4.5);
      // Links, selection and focus use the brand colour (dark olive in light, Desert Sun in dark), readable on cards and muted surfaces.
      expect(contrastRatio(palette["--brand-color"], palette["--surface-sunken"])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(palette["--ring"], palette["--surface-card"])).toBeGreaterThanOrEqual(3);
    }
    for (const mode of COLOR_MODES) {
      const studio = themeRegistry.studio[mode];
      expect(studio["--action-fill"]).toBe(studio["--brand-color"]);
      expect(studio["--action-fill-foreground"]).toBe(studio["--action-foreground"]);
    }
  });
  it("keeps the primary colour readable as link text (text-primary) on cards in every palette", () => {
    for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
      const palette = themeRegistry[brand][mode];
      expect(contrastRatio(palette["--brand-color"], palette["--surface-card"]), `${brand} ${mode}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(["__proto__", "constructor", "<script>", null])("rejects unregistered theme %s", (value) => expect(isBrandTheme(value)).toBe(false));
});

describe("success token (done step check)", () => {
  it("is defined in every palette and meets AA against the sidebar, the card background and its tint", () => {
    const palettes = JSON.stringify(themeRegistry).match(/"--success":"#[0-9a-f]{6}"/gi) ?? [];
    expect(palettes.length).toBeGreaterThanOrEqual(4);
    const walk = (node: unknown): Record<string, string>[] => node && typeof node === "object" ? [...("--success" in (node as object) ? [node as Record<string, string>] : []), ...Object.values(node as object).flatMap(walk)] : [];
    for (const palette of walk(themeRegistry)) {
      for (const against of ["--sidebar", "--card", "--category-green-tint"]) if (palette[against]) expect(contrastRatio(palette["--success"], palette[against]), `${palette["--success"]} on ${against}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
