import type { AdFormat, AdGoal, AdLevel, AdNetwork, AdStatus, ResultMetrics, Targeting } from "../../lib/ads/ads";

// Harvest-owned provider-neutral types for the Ads port. No adapter or vendor type may appear here.
export type AdsCredential = { readonly secret: string };
export type AdsPage<T> = { items: T[]; nextCursor: string | null };
export type RemoteAdAccount = { ref: string; network: AdNetwork; name: string; currency: string | null; timezone: string | null; status: "active" | "restricted" | "disabled" | "closed" | "unknown" };
export type HealthCheckState = "ok" | "warning" | "failing" | "unknown";
export type RemoteHealth = {
  status: RemoteAdAccount["status"];
  /** Each check is reported on its own; a check the provider cannot answer is "unknown", never "ok". */
  checks: Partial<Record<"account_status" | "payment_method" | "spend_limit" | "page_link" | "instagram_link" | "lead_ads_terms" | "pixel" | "whatsapp_link", { state: HealthCheckState; fixUrl?: string | null }>>;
  newestPixelEventAt: Date | null; lastRefusal: { code: string; fixUrl: string | null } | null;
};
export type RemoteAd = { ref: string; name: string; status: AdStatus; format: AdFormat; creativeRef: string | null; sourcePostRef: string | null; leadFormRef: string | null;
  review: "unknown" | "in_review" | "approved" | "rejected"; reviewReason: string | null; deliveryIssue: string | null };
export type RemoteAdSet = { ref: string; name: string; status: AdStatus; budgetAmount: number | null; budgetType: "daily" | "lifetime" | null; startDate: string | null; endDate: string | null;
  bidding: { costType: string; unitCost?: number } | null; targeting: Targeting | Record<string, unknown>; ads: RemoteAd[] };
export type RemoteCampaign = { ref: string; name: string; goal: AdGoal; status: AdStatus; budgetAmount: number | null; budgetType: "daily" | "lifetime" | null; budgetLevel: "campaign" | "adset" | null;
  sharedBudgetRef: string | null; startDate: string | null; endDate: string | null; bidding: { costType: string; unitCost?: number } | null; specialAdCategories: string[]; attributionModel: string; adSets: RemoteAdSet[] };
export type ResultRow = { level: AdLevel; ref: string; day: string; metrics: ResultMetrics };
export type AdsQuery = { accountRef: string; adAccountRef: string };
export type LaunchSpec = AdsQuery & { idempotencyKey: string; kind: "campaign" | "boost" | "add_ad"; payload: Record<string, unknown>; validateOnly?: boolean; targetAdSetRef?: string };
export type LaunchOutcome = { campaignRef: string | null; adSetRef: string | null; adRef: string | null };
export type ValidationOutcome = { ok: boolean; problems: string[] };
export type MutationSpec = AdsQuery & { idempotencyKey: string; level: AdLevel; ref: string };
export type RemoteLeadForm = { ref: string; name: string; status: "active" | "archived"; questions: string[]; consentText: string };
export type RemoteLead = { ref: string; network: AdNetwork; formRef: string | null; campaignRef: string | null; adRef: string | null; fields: Record<string, string>; submittedAt: Date | null };
export type RemoteAudience = { ref: string; kind: "custom" | "lookalike" | "saved_targeting" | "website" | "engagement" | "customer_list"; name: string; sizeEstimate: number | null; spec: Record<string, unknown> | null };
export type RemoteBoostablePost = { ref: string; platform: string; caption: string | null; publishedAt: Date | null };
export type RemoteIdentity = { ref: string; name: string; sparkCodeSupported: boolean };
export type TargetingHit = { id: string; name: string; kind: string };
export type RemoteConversionDestination = { ref: string; kind: "pixel" | "conversion_api" | "offline"; name: string; lastEventAt: Date | null; status: "unknown" | "active" | "inactive" };
/** Hashed identifiers only (SHA-256 of the normalised email or phone). The call is hard-off in every adapter that can reach a network. */
export type HashedIdentity = { email?: string; phone?: string };
export type ConversionEventBatch = AdsQuery & { destinationRef: string; idempotencyKey: string; events: { name: string; at: Date; eventId: string; userData: HashedIdentity }[] };
export type AudienceUploadSpec = AdsQuery & { audienceRef: string; idempotencyKey: string; members: HashedIdentity[] };
export type AdsEvent = {
  eventId: string; type: "ad_account.status_changed" | "account.ads.sync_failed" | "account.ads.sync_recovered" | "account.ads.initial_sync_completed"
    | "campaign.updated" | "ad_set.updated" | "ad.updated" | "ad.review_updated" | "ad.delivery_issue" | "lead.received" | "ad_rule.run";
  accountRef: string; subjectRef: string | null; data: Record<string, unknown>; occurredAt: Date;
};

/** A validated launch payload read field by field by the fake and the recorder; the strict shape is enforced upstream by the zod schemas. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LoosePayload = Record<string, any>;
