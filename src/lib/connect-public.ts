import type { Locale } from "../i18n/locale";

/** Public presentation only; no Campaigns/Forms entity or tenant/person identifiers. */
export type PublicLanding = Readonly<{
  version: 1;
  source: "starter-preview";
  publication: "published";
  publicCode: string;
  locale: Locale;
  resourceIds: readonly StarterResourceId[];
}>;

// Explicitly allowlisted for this preview. Ministry/content approval for launch is pending.
export const starterResources = [
  { id: "first-reading", sections: ["begin", "dayOne", "dayTwo", "dayThree"] },
  { id: "common-questions", sections: ["start", "questions", "pace"] },
  { id: "keep-exploring", sections: ["reread", "talk", "return"] },
] as const;
export type StarterResourceId = (typeof starterResources)[number]["id"];

export const previewPublicCode = "9f4c2a71d8e64b30a6f9c1057b2d8e43";
const preview: PublicLanding = Object.freeze({
  version: 1,
  source: "starter-preview",
  publication: "published",
  publicCode: previewPublicCode,
  locale: "en",
  resourceIds: Object.freeze(starterResources.map(({ id }) => id)),
});

/** Exact, opaque lookup. Never use a supplied code as a tenant, contact or form ID. */
export function getPublicLanding(code: string): PublicLanding | undefined {
  return code === preview.publicCode ? preview : undefined;
}

/**
 * HC-03: what the DB-backed resolver may expose for a published campaign link. Only these fields:
 * no tenant, campaign, link, form, response or person identifier, and no internal campaign name.
 */
export type CampaignLanding = Readonly<{
  version: 1;
  source: "campaign-link";
  publication: "published";
  locale: Locale;
  /** Organizer-entered public title, or null for the generic welcome. */
  title: string | null;
  resourceIds: readonly StarterResourceId[];
  /** HC-05 owns intake: no campaign link accepts a submission in HC-03. */
  acceptsResponses: false;
}>;
export type LandingView = PublicLanding | CampaignLanding;
export function campaignLanding(locale: Locale, title: string | null): CampaignLanding {
  return Object.freeze({ version: 1, source: "campaign-link", publication: "published", locale, title,
    resourceIds: Object.freeze(starterResources.map(({ id }) => id)), acceptsResponses: false });
}

export function getStarterResource(id: string) {
  return starterResources.find((resource) => resource.id === id);
}
