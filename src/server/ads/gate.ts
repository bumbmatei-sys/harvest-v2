import "server-only";
import { message } from "../../i18n/messages";
import { AccessError } from "../permissions";
import { socialPublishGateOpen } from "../social-publish-gate";
import { FakeAdsProvider } from "./fake-provider";
import { seedSyntheticAds } from "./seed";
import { defaultAdsDeps, type AdsDeps } from "./registry";

/**
 * Non-production gate, the same switch as the Social screens. Open only outside production; the routes then use ONE in-memory fake provider that never touches a network.
 * ADS_INTEGRATION_ENABLED and ZERNIO_ADS_LIVE_NETWORK stay the literal `false`.
 */
export const ADS_TEST_CREDENTIAL = "harvest-test-credential";
const fake = new FakeAdsProvider(ADS_TEST_CREDENTIAL);
// Invented accounts, campaigns and results for the Ads screens; they live only inside this in-memory fake, which only the open gate can reach.
if (socialPublishGateOpen()) seedSyntheticAds(fake);
export function adsRouteDeps(env: Record<string, string | undefined> = process.env): AdsDeps {
  return socialPublishGateOpen(env) ? { enabled: true, features: { leadFormPublish: true }, provider: (id) => { if (id === "fake") return fake; throw new AccessError(404, message("Errors.workspaceUnavailable")); }, now: () => new Date() } : defaultAdsDeps();
}
