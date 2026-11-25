import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import messages from "../../messages/en.json";
import { campaignTypes } from "../../src/lib/campaigns";
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
  it("reads its colours only from the palette's art slots, one slot per type", () => {
    const slots = campaignTypes.map((type) => {
      const vars = Object.values(campaignTypeArtVars(type)) as string[];
      for (const value of vars) expect(value).toMatch(/^var\(--art-[1-5]-(from|to|glow|ink)\)$/);
      return vars[0];
    });
    expect(new Set(slots).size).toBe(campaignTypes.length);
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
