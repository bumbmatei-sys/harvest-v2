import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../src/lib/theme";
import { ACCENTS, ACCENT_TOKENS, ART_SLOTS, ART_TOKENS, BRAND_THEMES, COLOR_MODES, PALETTE_EXTENSION_TEMPLATE, themeRegistry, themeStyles } from "../../src/lib/theme-registry";

// The accent and artwork tokens are part of every palette's contract: the current palettes and each of the 12 future themes
// (docs/design/theme-candidates.md) must define them in light and dark, at these contrasts. A new palette copies PALETTE_EXTENSION_TEMPLATE.
const palettes = BRAND_THEMES.flatMap((brand) => COLOR_MODES.map((mode) => ({ brand, mode, palette: themeRegistry[brand][mode] as Record<string, string> })));

describe("palette contract: accents and artwork", () => {
  it("the template names exactly the accent and artwork tokens", () => {
    expect(Object.keys(PALETTE_EXTENSION_TEMPLATE).sort()).toEqual([...ACCENT_TOKENS, ...ART_TOKENS].sort());
    expect(ACCENTS[0]).toBe("primary");
    expect(ACCENTS.length).toBeLessThanOrEqual(4);
    expect(ART_SLOTS).toHaveLength(5);
  });
  it.each(palettes)("$brand $mode defines every token as a colour and emits it", ({ brand, mode, palette }) => {
    for (const token of Object.keys(PALETTE_EXTENSION_TEMPLATE)) {
      expect(palette[token], `${brand} ${mode} ${token}`).toMatch(/^#[0-9a-f]{6}$/);
      expect(themeStyles).toContain(`${token}:${palette[token]}`);
    }
  });
  it.each(palettes)("$brand $mode keeps each accent at 3:1 on the card, the muted surface and its own soft fill", ({ brand, mode, palette }) => {
    for (const accent of ACCENTS) {
      const solid = palette[`--accent-${accent}`];
      for (const against of [palette["--surface-card"], palette["--surface-sunken"], palette[`--accent-${accent}-soft`]])
        expect(contrastRatio(solid, against), `${brand} ${mode} ${accent} on ${against}`).toBeGreaterThanOrEqual(3);
    }
  });
  it.each(palettes)("$brand $mode draws artwork lines at 3:1 on the deep end of each gradient, with five distinct families", ({ brand, mode, palette }) => {
    for (const slot of ART_SLOTS) expect(contrastRatio(palette[`--art-${slot}-ink`], palette[`--art-${slot}-to`]), `${brand} ${mode} art ${slot}`).toBeGreaterThanOrEqual(3);
    expect(new Set(ART_SLOTS.map((slot) => palette[`--art-${slot}-from`])).size).toBe(5);
  });
});
