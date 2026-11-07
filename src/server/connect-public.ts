import "server-only";
import { cache } from "react";
import { getDb } from "../db/client";
import { resolveFromLocales, locales } from "../i18n/locale";
import { campaignLanding, getPublicLanding, type LandingView } from "../lib/connect-public";
import { normalizeShortCode, publicCodePattern } from "../lib/connect-links";
import { resolveConnectLink } from "./connect-links";

// HC-03 + HC-04: the public landing boundary. The static HC-04 preview resolves first; any other
// well-formed code goes to the constrained DB resolver. React's cache() dedupes the page and its
// metadata within ONE request only; nothing is cached across requests, so disabling, expiring,
// rotating or archiving a link takes effect on the next request.
export const findLandingByPublicCode = cache(async (code: string): Promise<LandingView | undefined> => {
  const preview = getPublicLanding(code);
  if (preview) return preview;
  if (!publicCodePattern.test(code)) return undefined;
  const row = await resolveConnectLink(getDb(), "qr", code);
  // Stored locales pass through the same resolver as browser languages (supported or English).
  return row ? campaignLanding(resolveFromLocales(row.locale, null, null, locales, "en"), row.title) : undefined;
});

export const findLandingByShortCode = cache(async (input: string): Promise<LandingView | undefined> => {
  const code = normalizeShortCode(input);
  if (!code) return undefined;
  const row = await resolveConnectLink(getDb(), "short", code);
  return row ? campaignLanding(resolveFromLocales(row.locale, null, null, locales, "en"), row.title) : undefined;
});
