import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { campaignTypes } from "../../src/lib/campaigns";
import { campaignArtTokens, COLOR_MODES, themeStyles } from "../../src/lib/theme-registry";
import { CampaignCoverPlaceholder, CampaignTypeArt, campaignTypeArtVars } from "../../src/components/campaigns/campaign-type-art";
import { TypeCards } from "../../src/components/campaigns/type-cards";

const render = (element: ReactElement) => renderToStaticMarkup(h(NextIntlClientProvider, { locale: "en", messages, children: element }));

describe("campaign type art", () => {
  it("draws decorative, self-contained art for every type", () => {
    const motifs = new Set<string>();
    for (const type of campaignTypes) {
      const html = render(h(CampaignTypeArt, { type }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain(`data-campaign-type-art="${type}"`);
      expect(html).toContain("<svg");
      // No external assets, no ids that could collide when the art renders several times on a page.
      expect(html).not.toMatch(/<image|href=|url\(|\bid="/);
      motifs.add(html.slice(html.lastIndexOf("<svg")));
    }
    expect(motifs.size).toBe(campaignTypes.length);
  });
  it("reads its colours only from art tokens that exist in both modes and in every theme's styles", () => {
    for (const type of campaignTypes) {
      for (const value of Object.values(campaignTypeArtVars(type)) as string[]) {
        const token = value.match(/^var\((--art-[a-z]+-[a-z]+)\)$/)?.[1] as keyof typeof campaignArtTokens.light;
        expect(token).toBeTruthy();
        for (const mode of COLOR_MODES) {
          expect(campaignArtTokens[mode][token]).toMatch(/^#[0-9a-f]{6}$/);
          expect(themeStyles).toContain(`${token}:${campaignArtTokens[mode][token]}`);
        }
      }
    }
    // Each type has its own colour family.
    expect(new Set(campaignTypes.map((type) => (campaignTypeArtVars(type) as Record<string, string>)["--from"])).size).toBe(5);
  });
  it("renders a cover placeholder variant", () => {
    const html = render(h(CampaignCoverPlaceholder, { type: "mission_trip", className: "rounded-xl" }));
    expect(html).toContain('data-campaign-type-art="mission_trip"');
    expect(html).toContain("aspect-[16/7]");
    expect(html).toContain("rounded-xl");
  });
  it("puts the art on every type card and keeps the radio names to the label and description", () => {
    const html = render(h(TypeCards, { value: "conference", onPick: () => {}, labelledBy: "x" }));
    expect(html.match(/role="radio"/g)).toHaveLength(5);
    expect(html.match(/data-campaign-type-art=/g)).toHaveLength(5);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain("Conference");
    // Only phrasing content inside each button.
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<div/s);
  });
});
