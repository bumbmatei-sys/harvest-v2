import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { Flag } from "lucide-react";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { AccentIcon, accentVars } from "../../src/components/accent-icon";
import { WizardLayout } from "../../src/components/wizard-layout";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));

describe("AccentIcon", () => {
  it("renders a decorative tinted tile for a named accent", () => {
    const html = render(h(AccentIcon, { icon: Flag, accent: "primary" }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('data-accent="primary"');
    expect(html).toContain("--accent-current:var(--accent-primary)");
    expect(html).toContain("<svg");
  });
  it("inherits the surrounding accent, or falls back to the neutral tile, when none is named", () => {
    const html = render(h(AccentIcon, { icon: Flag }));
    expect(html).not.toContain("data-accent");
    expect(html).not.toContain("style=");
    expect(html).toContain("var(--accent-current-soft,var(--muted))");
    expect(accentVars(null)).toEqual({});
  });
  it("has a neutral tone that keeps the tile on theme surface tokens and colours only the icon", () => {
    const html = render(h(AccentIcon, { icon: Flag, accent: "primary", tone: "neutral" }));
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain("bg-muted");
    expect(html).not.toContain("bg-[color:var(--accent-current-soft");
  });
});

describe("WizardLayout step icon", () => {
  const steps = [{ id: "a", label: "First", description: "Pick one" }, { id: "b", label: "Second" }];
  it("shows the step icon beside the heading", () => {
    const html = render(h(WizardLayout, { steps: steps.map((step) => ({ ...step, icon: h(AccentIcon, { icon: Flag, accent: "support-1" }) })), current: "a", onStepChange: () => {}, stepsLabel: "Steps", stepper: false, children: null }));
    expect(html).toContain('data-accent="support-1"');
    expect(html).toContain("First");
  });
  it("keeps the heading layout unchanged without an icon", () => {
    const html = render(h(WizardLayout, { steps, current: "a", onStepChange: () => {}, stepsLabel: "Steps", stepper: false, children: null }));
    expect(html).not.toContain("data-slot=\"accent-icon\"");
    expect(html).toContain('class="contents"');
  });
});
