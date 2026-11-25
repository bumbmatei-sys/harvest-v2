import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Flag } from "lucide-react";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { contrastRatio } from "../../src/lib/theme";
import { ACCENTS, BRAND_THEMES, COLOR_MODES, accentTokens, themeRegistry, themeStyles } from "../../src/lib/theme-registry";
import { AccentIcon, accentVars } from "../../src/components/accent-icon";
import { campaignTypeAccent } from "../../src/components/campaigns/campaign-type-art";
import { WizardLayout } from "../../src/components/wizard-layout";
import { campaignTypes } from "../../src/lib/campaigns";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));

describe("accent colours", () => {
  it("defines every accent in both modes, emitted for every brand theme", () => {
    for (const mode of COLOR_MODES) for (const accent of ACCENTS) for (const key of [`--accent-${accent}`, `--accent-${accent}-soft`] as const) {
      expect(accentTokens[mode][key]).toMatch(/^#[0-9a-f]{6}$/);
      expect(themeStyles).toContain(`${key}:${accentTokens[mode][key]}`);
    }
  });
  it("keeps each accent at 3:1 against the card surface and against its own soft fill, in every brand and mode", () => {
    for (const brand of BRAND_THEMES) for (const mode of COLOR_MODES) {
      const card = (themeRegistry[brand][mode] as Record<string, string>)["--surface-card"];
      for (const accent of ACCENTS) {
        const solid = accentTokens[mode][`--accent-${accent}`], soft = accentTokens[mode][`--accent-${accent}-soft`];
        expect(contrastRatio(solid, card), `${brand} ${mode} ${accent} on card`).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(solid, soft), `${brand} ${mode} ${accent} on soft`).toBeGreaterThanOrEqual(3);
      }
    }
  });
  it("gives every campaign type its own accent", () => {
    expect(new Set(campaignTypes.map((type) => campaignTypeAccent[type])).size).toBe(campaignTypes.length);
    for (const type of campaignTypes) expect(ACCENTS).toContain(campaignTypeAccent[type]);
  });
});

describe("AccentIcon", () => {
  it("renders a decorative tinted tile for a named accent", () => {
    const html = render(h(AccentIcon, { icon: Flag, accent: "violet" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-accent="violet"');
    expect(html).toContain("--accent-current:var(--accent-violet)");
    expect(html).toContain("<svg");
  });
  it("inherits the surrounding accent, or falls back to the neutral tile, when none is named", () => {
    const html = render(h(AccentIcon, { icon: Flag }));
    expect(html).not.toContain("data-accent");
    expect(html).not.toContain("style=");
    expect(html).toContain("var(--accent-current-soft,var(--muted))");
    expect(accentVars(null)).toEqual({});
  });
});

describe("WizardLayout step icon", () => {
  const steps = [{ id: "a", label: "First", description: "Pick one" }, { id: "b", label: "Second" }];
  it("shows the step icon beside the heading", () => {
    const html = render(h(WizardLayout, { steps: steps.map((step) => ({ ...step, icon: h(AccentIcon, { icon: Flag, accent: "sky" }) })), current: "a", onStepChange: () => {}, stepsLabel: "Steps", stepper: false, children: null }));
    expect(html).toContain('data-accent="sky"');
    expect(html).toContain("First");
  });
  it("keeps the heading layout unchanged without an icon", () => {
    const html = render(h(WizardLayout, { steps, current: "a", onStepChange: () => {}, stepsLabel: "Steps", stepper: false, children: null }));
    expect(html).not.toContain("data-slot=\"accent-icon\"");
    expect(html).toContain('class="contents"');
  });
});

describe("department and feature chips", async () => {
  const { departmentMarks, moduleMarks } = await import("../../src/components/campaigns/wizard-icons");
  const { departmentKeys, moduleKeys } = await import("../../src/lib/campaign-wizard");
  it("gives each of the 13 departments and 18 features its own icon and a defined accent, with neighbours in different colours", () => {
    for (const [keys, marks] of [[departmentKeys, departmentMarks], [moduleKeys, moduleMarks]] as const) {
      const list = keys.map((key) => (marks as Record<string, { icon: unknown; accent: string }>)[key]);
      expect(list.every(Boolean)).toBe(true);
      expect(new Set(list.map((mark) => mark.icon)).size).toBe(keys.length);
      for (const mark of list) expect(ACCENTS).toContain(mark.accent);
      for (let i = 1; i < list.length; i++) expect(list[i].accent).not.toBe(list[i - 1].accent);
    }
    expect(departmentKeys).toHaveLength(13);
    expect(moduleKeys).toHaveLength(18);
  });
});
