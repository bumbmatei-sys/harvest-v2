import { z } from "zod";

// Pure Ads domain rules shared by the server and (later) screens. No imports from server code. Ministries use their own ad accounts; Harvest handles no ad payments.
export const adNetworks = ["meta", "google", "linkedin", "tiktok", "pinterest", "x", "reddit", "microsoft", "snapchat", "amazon"] as const;
export type AdNetwork = typeof adNetworks[number];
/** Networks the first screens offer; the others are modelled but never faked as ready. */
export const adNetworksFirst = ["meta", "google"] as const;
export const adGoals = ["engagement", "traffic", "awareness", "video_views", "lead_generation", "conversions", "messages", "app_promotion"] as const;
export type AdGoal = typeof adGoals[number];
export const adFormats = ["image", "video", "carousel", "document", "event", "text", "messaging", "call"] as const;
export type AdFormat = typeof adFormats[number];
export const messagingDestinations = ["whatsapp", "messenger", "instagram_direct"] as const;
/** Where an ad may run. No list (or an empty one) means automatic placements. */
export const adPlacements = ["feed", "stories", "reels", "search", "messages"] as const;
export const budgetTypes = ["daily", "lifetime"] as const;
export const budgetLevels = ["campaign", "adset"] as const;
export const adLevels = ["campaign", "adset", "ad"] as const;
export type AdLevel = typeof adLevels[number];
export const adStatuses = ["active", "paused", "archived", "deleted"] as const;
export type AdStatus = typeof adStatuses[number];
export const reviewStatuses = ["unknown", "in_review", "approved", "rejected"] as const;
export const leadStatuses = ["new", "contacted", "unreachable", "qualified", "converted", "disqualified"] as const;
export type LeadStatus = typeof leadStatuses[number];
export const attributionModels = ["default", "last_click", "last_touch", "data_driven", "first_click", "linear", "position_based", "time_decay"] as const;
export const audienceKinds = ["custom", "lookalike", "saved_targeting", "website", "engagement", "customer_list"] as const;
export const healthChecks = ["account_status", "payment_method", "spend_limit", "page_link", "instagram_link", "lead_ads_terms", "pixel", "whatsapp_link"] as const;
export const healthStates = ["ok", "warning", "failing", "unknown"] as const;
export const alertKinds = ["ad_rejected", "delivery_issue", "payment_problem", "spend_without_results", "budget_capped", "connection_lost", "sync_failed", "account_restricted"] as const;
export const specialAdCategories = ["housing", "employment", "credit", "social_issues_elections_politics", "financial_products_services", "none"] as const;
/** Launch of an ad flagged with these is refused until a policy exists (PRD 5.5 open decisions; default refuse). */
export const refusedAdCategories = ["social_issues_elections_politics"] as const;
export const resultMetrics = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "results", "costPerResult", "conversions", "leads"] as const;
export type ResultMetric = typeof resultMetrics[number];
export type ResultMetrics = Partial<Record<ResultMetric, number>>;
export const ruleMetrics = ["costPerResult", "spend", "ctr", "cpc", "cpm", "results", "impressions", "clicks"] as const;
export const ruleOperators = ["gt", "gte", "lt", "lte"] as const;
/** Founder decision 26 Nov: rules only flag. `pause` survives only on rules stored before 0125; they stay off and are never run. */
export const ruleActions = ["notify"] as const;
export const storedRuleActions = ["pause", "notify"] as const;
export const bulkStatusLimit = 50;
export const maxTargetingBytes = 16_384;
export const maxRawTargetingBytes = 16_384;

const text = (max: number) => z.string().trim().min(1).max(max).refine(v => v.isWellFormed() && !v.includes("\u0000"));
export const refInput = z.string().min(1).max(200).refine(v => v.isWellFormed() && !v.includes("\u0000"));
export const uuidKey = z.uuid();
export const versionInput = z.number().int().min(1).max(2_147_483_646);
export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(`${v}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v; });
const money = z.number().positive().max(1_000_000).refine(v => Math.round(v * 100) / 100 === v, "two decimals at most");
const iso2 = z.string().regex(/^[A-Z]{2}$/);
const lang = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/);

const location = z.object({ kind: z.enum(["country", "region", "city", "zip", "metro"]), ref: refInput, name: text(120).optional(), radiusKm: z.number().min(1).max(80).optional() }).strict();
const pin = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusKm: z.number().min(1).max(80) }).strict();
const idName = z.object({ id: refInput, name: text(120).optional() }).strict();
export const targetingSchema = z.object({
  countries: z.array(iso2).max(250).optional(),
  locations: z.array(location).max(200).optional(),
  excludedLocations: z.array(location).max(200).optional(),
  pins: z.array(pin).max(50).optional(),
  languages: z.array(lang).max(50).optional(),
  ageMin: z.number().int().min(13).max(65).optional(),
  ageMax: z.number().int().min(13).max(65).optional(),
  genders: z.array(z.enum(["male", "female", "all"])).max(3).optional(),
  interests: z.array(idName).max(50).optional(),
  behaviours: z.array(idName).max(50).optional(),
  includeAudiences: z.array(refInput).max(50).optional(),
  excludeAudiences: z.array(refInput).max(50).optional(),
  savedTargetingId: refInput.optional(),
  advantageAudience: z.boolean().optional(),
}).strict().refine(v => v.ageMin === undefined || v.ageMax === undefined || v.ageMin <= v.ageMax, "age range")
  .refine(v => JSON.stringify(v).length <= maxTargetingBytes, "targeting too large");
export type Targeting = z.infer<typeof targetingSchema>;
/** Opaque provider-native targeting. Owner only, hidden by default, never interpreted. */
export const rawTargetingSchema = z.record(z.string().max(60), z.unknown()).refine(v => JSON.stringify(v).length <= maxRawTargetingBytes, "raw targeting too large");

export const biddingSchema = z.object({ costType: z.enum(["lowest_cost", "cost_cap", "bid_cap", "target_cost", "manual_cpc", "manual_cpm"]), unitCost: money.optional() }).strict();

const card = z.object({ mediaRef: refInput, headline: text(80).optional(), linkUrl: z.url().max(2048).optional() }).strict();
export const creativeSchema = z.object({
  format: z.enum(adFormats),
  mediaRefs: z.array(refInput).max(10).optional(),
  cards: z.array(card).min(2).max(10).optional(),
  headline: text(200).optional(), body: text(2000).optional(), callToAction: text(40).optional(), linkUrl: z.url().max(2048).optional(),
  messagingDestination: z.enum(messagingDestinations).optional(), phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  leadFormId: uuidKey.optional(), eventRef: refInput.optional(), documentRef: refInput.optional(),
}).strict().superRefine((v, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (v.format === "carousel" && (!v.cards || v.cards.length < 2 || v.cards.length > 10)) bad("carousel needs 2 to 10 cards");
  if (v.format !== "carousel" && v.cards) bad("cards only on carousel");
  if (v.format === "messaging" && !v.messagingDestination) bad("messaging destination");
  if (v.format === "call" && !v.phoneNumber) bad("phone number");
  if ((v.format === "image" || v.format === "video") && !v.mediaRefs?.length) bad("media");
  if (v.format === "event" && !v.eventRef) bad("event");
  if (v.format === "document" && !v.documentRef) bad("document");
});
export type Creative = z.infer<typeof creativeSchema>;

const schedule = { startDate: isoDay.optional(), endDate: isoDay.optional() };
const campaignShape = {
  adAccountId: uuidKey, name: text(200), adSetName: text(200).optional(), goal: z.enum(adGoals),
  budgetAmount: money, budgetType: z.enum(budgetTypes).default("daily"), budgetLevel: z.enum(budgetLevels).default("campaign"),
  ...schedule, status: z.enum(["paused", "active"]).default("paused"),
  bidding: biddingSchema.optional(), specialAdCategories: z.array(z.enum(specialAdCategories)).max(5).default([]),
  attributionModel: z.enum(attributionModels).default("default"),
  targeting: targetingSchema.optional(), rawTargeting: rawTargetingSchema.optional(), placements: z.array(z.enum(adPlacements)).max(10).optional(),
  creative: creativeSchema.optional(), trackingTags: z.string().max(500).optional(),
};
function scheduleRules(v: { budgetType: string; startDate?: string; endDate?: string; goal?: string; creative?: Creative }, ctx: z.RefinementCtx) {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (v.budgetType === "lifetime" && !v.endDate) bad("lifetime budget needs an end date");
  if (v.startDate && v.endDate && v.endDate < v.startDate) bad("end before start");
  if (v.goal === "lead_generation" && v.creative && !v.creative.leadFormId) bad("lead generation needs a lead form");
  if (v.goal === "messages" && v.creative && v.creative.format !== "messaging") bad("messages goal needs a messaging ad");
}
export const createCampaignInput = z.object(campaignShape).strict().superRefine(scheduleRules);
export type CreateCampaignInput = z.infer<typeof createCampaignInput>;
export const boostInput = z.object({
  adAccountId: uuidKey, name: text(200), postRef: refInput, goal: z.enum(adGoals), budgetAmount: money, budgetType: z.enum(budgetTypes).default("daily"),
  ...schedule, existingAdSetId: uuidKey.optional(), targeting: targetingSchema.optional(), rawTargeting: rawTargetingSchema.optional(), placements: z.array(z.enum(adPlacements)).max(10).optional(),
  specialAdCategories: z.array(z.enum(specialAdCategories)).max(5).default([]), identityRef: refInput.optional(), sparkCode: z.string().min(1).max(200).optional(),
  attributionModel: z.enum(attributionModels).default("default"), status: z.enum(["paused", "active"]).default("paused"),
}).strict().superRefine(scheduleRules);
export const addAdInput = z.object({ adAccountId: uuidKey, adSetId: uuidKey, name: text(200), creative: creativeSchema, status: z.enum(["paused", "active"]).default("paused") }).strict();
export const launchKinds = ["campaign", "boost", "add_ad"] as const;
export type LaunchKind = typeof launchKinds[number];
export const launchPayload = (kind: LaunchKind, value: unknown) =>
  (kind === "campaign" ? createCampaignInput : kind === "boost" ? boostInput : addAdInput).parse(value);
export function isRefusedCategory(payload: { specialAdCategories?: readonly string[] }) {
  return (payload.specialAdCategories ?? []).some(c => (refusedAdCategories as readonly string[]).includes(c));
}

export const statusInput = z.object({ level: z.enum(adLevels), id: uuidKey, status: z.enum(["active", "paused"]), version: versionInput, idempotencyKey: uuidKey }).strict();
export const bulkStatusInput = z.object({ status: z.enum(["active", "paused"]), items: z.array(z.object({ level: z.enum(adLevels), id: uuidKey, version: versionInput }).strict()).min(1).max(bulkStatusLimit), idempotencyKey: uuidKey }).strict();
export const renameInput = z.object({ level: z.enum(adLevels), id: uuidKey, name: text(200), version: versionInput }).strict();
export const budgetInput = z.object({
  level: z.enum(["campaign", "adset"]), id: uuidKey, version: versionInput, idempotencyKey: uuidKey, confirm: z.literal(true),
  budgetAmount: money.optional(), bidding: biddingSchema.optional(), endDate: isoDay.optional(),
}).strict().refine(v => v.budgetAmount !== undefined || v.bidding !== undefined || v.endDate !== undefined, "nothing to change");
export const deleteInput = z.object({ level: z.enum(adLevels), id: uuidKey, version: versionInput, idempotencyKey: uuidKey, confirmIrreversible: z.literal(true) }).strict();
export const ruleInput = z.object({
  adAccountId: uuidKey, name: text(120), level: z.enum(adLevels).default("campaign"),
  condition: z.object({ metric: z.enum(ruleMetrics), operator: z.enum(ruleOperators), threshold: z.number().min(0).max(1e9), windowDays: z.number().int().min(1).max(30).default(3) }).strict(),
  action: z.enum(ruleActions),
}).strict();
export const leadStatusInput = z.object({ status: z.enum(leadStatuses), version: versionInput }).strict();
export const leadFormInput = z.object({
  adAccountId: uuidKey, name: text(120), consentText: text(1000), privacyUrl: z.url().max(2048),
  questions: z.array(z.enum(["full_name", "first_name", "last_name", "email", "phone", "city", "zip", "country", "custom", "consent_newsletter", "consent_follow_up", "consent_marketing"])).min(1).max(15),
}).strict();

/** Counts only: ratios are recomputed from the counts so a stored ratio is never trusted. */
export function projectResults(input: Record<string, unknown>): ResultMetrics {
  const out: ResultMetrics = {};
  for (const key of resultMetrics) { const v = input[key]; if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 9_007_199_254_740_991) out[key] = v; }
  return out;
}
export function deriveRatios(m: ResultMetrics): ResultMetrics {
  const out = { ...m };
  if (m.clicks !== undefined && m.impressions) out.ctr = m.clicks / m.impressions;
  if (m.spend !== undefined && m.clicks) out.cpc = m.spend / m.clicks;
  if (m.spend !== undefined && m.impressions) out.cpm = (m.spend / m.impressions) * 1000;
  if (m.spend !== undefined && m.results) out.costPerResult = m.spend / m.results;
  return out;
}
/** A metric that was not reported is unavailable, never zero. */
export function reading(m: ResultMetrics, key: ResultMetric) { return m[key] === undefined ? { value: null, availability: "unavailable" as const } : { value: m[key]!, availability: "available" as const }; }

export function evaluateRule(c: { metric: typeof ruleMetrics[number]; operator: typeof ruleOperators[number]; threshold: number }, m: ResultMetrics) {
  const v = m[c.metric];
  if (v === undefined) return false;
  return c.operator === "gt" ? v > c.threshold : c.operator === "gte" ? v >= c.threshold : c.operator === "lt" ? v < c.threshold : v <= c.threshold;
}
/** Valid status moves. Archived and deleted are terminal. */
export function canMove(from: AdStatus, to: AdStatus) { return from !== "deleted" && from !== "archived" && (to === "active" || to === "paused" ? from !== to : true); }

// ---- CRM audiences and conversions (0104). Hashed identifiers only; every figure and send is gated by consent in the service layer. ----
/** Normalised, then SHA-256 hex. Email: lower case, trimmed. Phone: digits with the country code. Nothing else is ever sent to an ad network. */
export const normaliseEmail = (value: string) => value.trim().toLowerCase();
export const normalisePhone = (value: string) => value.replace(/[^0-9]/g, "");
/** Calling-code prefixes of the EEA, the UK and Switzerland, used only as a conservative signal: a phone number is the one location hint the CRM holds. */
export const eeaUkChPhonePrefixes = ["30", "31", "32", "33", "34", "351", "352", "353", "354", "356", "357", "358", "359", "36", "370", "371", "372", "385", "386", "39", "40", "41", "420", "421", "423", "43", "44", "45", "46", "47", "48", "49"] as const;
export const eeaUkChCountries = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH", "GB", "UK"] as const;
export function isEeaUkChPhone(phone: string | null | undefined) {
  if (!phone || !phone.trim().startsWith("+")) return false;
  const digits = normalisePhone(phone);
  return eeaUkChPhonePrefixes.some(prefix => digits.startsWith(prefix));
}
export const adConsentQuestions = ["consent_newsletter", "consent_follow_up"] as const;
export const conversionEventNames = ["Lead", "Contact", "CompleteRegistration", "QualifiedLead"] as const;
export const audienceUploadInput = z.object({ adAccountId: uuidKey, audienceId: uuidKey, idempotencyKey: uuidKey, confirm: z.literal(true) }).strict();
export const customerAudienceInput = z.object({ adAccountId: uuidKey, savedViewId: uuidKey, name: text(200), idempotencyKey: uuidKey }).strict();
export const conversionSendInput = z.object({ adAccountId: uuidKey, destinationId: uuidKey, eventName: z.enum(conversionEventNames), leadIds: z.array(uuidKey).min(1).max(200), idempotencyKey: uuidKey, confirm: z.literal(true) }).strict();
