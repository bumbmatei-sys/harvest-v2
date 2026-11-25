import type { AdsEvent } from "./contract";
import { AdsProviderError, type AdsProvider } from "./port";
import { parseAdsEvent } from "./webhook-parse";
import { verifyBodySignature } from "../social/webhook-signature";

// Vendor adapter for the Ads port. HARD-OFF: this module contains no transport and never opens a connection. Every network method refuses with DISABLED.
// Enabling needs a separate change: Ads add-on contract, sandbox verification with a real ad account, rate-limit plan, legal review of platform ad policies
// and independent security review. Live network stays the literal `false`.
export const ZERNIO_ADS_LIVE_NETWORK = false;

/*
 * TODO(live): fields and behaviours still to confirm against the provider's live API (documentation read 25 Nov 2026; live behaviour unverified):
 *  - Endpoint and field mapping per method. Create is one flat call (account id, ad-account id, name, goal, budgetAmount in whole units, budgetType, budgetLevel,
 *    start/end dates in the ad-account timezone, status default PAUSED, costType/unitCost, special ad categories, creative fields, targeting fields, campaignType on Google).
 *  - Which networks accept which goals, formats and minimum budgets; app promotion; Google campaign types (search, display, pmax, demand_gen) and their required assets.
 *  - Boost: listing of boostable posts per network, attaching to an existing ad set, TikTok identities and Spark codes.
 *  - Targeting lookup endpoints and id shapes; saved targeting; raw targeting passthrough key.
 *  - Review status vocabulary and refusal reasons; delivery-issue vocabulary; delete versus archive behaviour per network and level.
 *  - Results: breakdown parameters, attribution-model parameter name, freshness and async report limits, how "no data" differs from zero.
 *  - Lead forms: create body, consent text field, per-network lead listing, status updates on the provider side.
 *  - Webhook envelope: names for campaign, ad set and ad changes (this port assumes campaign.updated, ad_set.updated, ad.updated), review and delivery-issue events,
 *    signature header name and scheme. Confirm replay window and event id stability across the missed-lead recovery pass.
 *  - Conversion sends: shape only here; privacy and consent design is an open founder decision and nothing is sent.
 */
const off = (): never => { throw new AdsProviderError("DISABLED"); };

export class ZernioAdsAdapter implements AdsProvider {
  readonly id = "zernio" as const;
  readonly signatureHeader = "x-zernio-signature";
  listAdAccounts = async () => off(); getAdAccountHealth = async () => off(); listCampaignTree = async () => off(); readResults = async () => off();
  validateLaunch = async () => off(); launch = async () => off(); listBoostablePosts = async () => off(); listIdentities = async () => off();
  setStatus = async () => off(); bulkSetStatus = async () => off(); rename = async () => off(); setBudget = async () => off(); remove = async () => off();
  listSharedBudgets = async () => off(); searchTargeting = async () => off(); listAudiences = async () => off(); createLeadForm = async () => off();
  listLeadForms = async () => off(); listLeads = async () => off(); listConversionDestinations = async () => off(); sendConversionEvents = async () => off(); createCustomerListAudience = async () => off(); uploadAudienceMembers = async () => off();
  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]) { return verifyBodySignature(rawBody, signature, secrets); }
  parseWebhookEvent(rawBody: string): AdsEvent | null { return parseAdsEvent(rawBody); }
}
