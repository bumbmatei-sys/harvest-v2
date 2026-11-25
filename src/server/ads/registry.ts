import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import type { AdsProvider } from "./port";
import { ZernioAdsAdapter } from "./zernio-ads-adapter";

// Intentionally a literal constant, not an environment toggle (same pattern as SOCIAL_INTEGRATION_ENABLED). While false every Ads route and the webhook answer the same
// unavailable response and nothing is linked, launched, changed or sent. Production can never enable it without a separate reviewed change.
export const ADS_INTEGRATION_ENABLED = false;

export type AdsDeps = { enabled: boolean; provider: (id: "zernio" | "fake") => AdsProvider; now: () => Date };
export const defaultAdsDeps = (): AdsDeps => ({
  enabled: ADS_INTEGRATION_ENABLED,
  provider: (id) => { if (id === "zernio") return new ZernioAdsAdapter(); throw new AccessError(404, message("Errors.workspaceUnavailable")); },
  now: () => new Date(),
});
export const assertAdsEnabled = (deps: AdsDeps) => { if (!deps.enabled) throw new AccessError(404, message("Errors.workspaceUnavailable")); };
