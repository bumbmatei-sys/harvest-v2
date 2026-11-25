import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import type { AdsProvider } from "./port";
import { ZernioAdsAdapter } from "./zernio-ads-adapter";

// Intentionally a literal constant, not an environment toggle (same pattern as SOCIAL_INTEGRATION_ENABLED). While false every Ads route and the webhook answer the same
// unavailable response and nothing is linked, launched, changed or sent. Production can never enable it without a separate reviewed change.
export const ADS_INTEGRATION_ENABLED = false;

// Separate literal switches for the paths that send or schedule anything. All false: audience uploads, conversion sends and the scheduled results sync are built and tested but cannot run.
export const ADS_AUDIENCE_UPLOAD_ENABLED = false;
export const ADS_CONVERSIONS_SEND_ENABLED = false;
export const ADS_RESULTS_SYNC_ENABLED = false;
// Publishing a Harvest-built ad lead form to a network's instant form is a provider write, so it has its own literal switch (false). Drafting and editing the form never reaches a network.
export const ADS_LEAD_FORM_PUBLISH_ENABLED = false;
export type AdsFeatures = { audienceUpload: boolean; conversionsSend: boolean; resultsSync: boolean; leadFormPublish: boolean };
export type AdsDeps = { enabled: boolean; provider: (id: "zernio" | "fake") => AdsProvider; now: () => Date; features?: Partial<AdsFeatures> };
export const adsFeature = (deps: Pick<AdsDeps, "features">, name: keyof AdsFeatures) =>
  deps.features?.[name] ?? { audienceUpload: ADS_AUDIENCE_UPLOAD_ENABLED, conversionsSend: ADS_CONVERSIONS_SEND_ENABLED, resultsSync: ADS_RESULTS_SYNC_ENABLED, leadFormPublish: ADS_LEAD_FORM_PUBLISH_ENABLED }[name];
export const defaultAdsDeps = (): AdsDeps => ({
  enabled: ADS_INTEGRATION_ENABLED,
  provider: (id) => { if (id === "zernio") return new ZernioAdsAdapter(); throw new AccessError(404, message("Errors.workspaceUnavailable")); },
  now: () => new Date(),
});
export const assertAdsEnabled = (deps: AdsDeps) => { if (!deps.enabled) throw new AccessError(404, message("Errors.workspaceUnavailable")); };
