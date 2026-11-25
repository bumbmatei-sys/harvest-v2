import type {
  AdsCredential, AdsEvent, AdsPage, AdsQuery, AudienceUploadSpec, ConversionEventBatch, LaunchOutcome, LaunchSpec, MutationSpec, RemoteAdAccount, RemoteAudience, RemoteBoostablePost, RemoteCampaign,
  RemoteConversionDestination, RemoteHealth, RemoteIdentity, RemoteLead, RemoteLeadForm, ResultRow, TargetingHit, ValidationOutcome,
} from "./contract";
import type { AdLevel, AdStatus } from "../../lib/ads/ads";

export const adsProviderErrorCodes = ["AUTH", "RATE_LIMITED", "INVALID_REQUEST", "NOT_FOUND", "CONFLICT", "UNAVAILABLE", "DISABLED", "UNSUPPORTED", "FORBIDDEN"] as const;
export type AdsProviderErrorCode = typeof adsProviderErrorCodes[number];
/** The only error a provider may throw. The message is the fixed code: never a response body, token or request content. */
export class AdsProviderError extends Error {
  readonly retryable: boolean;
  constructor(public readonly code: AdsProviderErrorCode, public readonly retryAfterMs: number | null = null) { super(code); this.retryable = code === "RATE_LIMITED" || code === "UNAVAILABLE"; }
}

/** Provider-neutral Ads port. Implemented by the fake and by the hard-disabled vendor adapter. Every mutating call carries an idempotency key. */
export interface AdsProvider {
  readonly id: "fake" | "zernio";
  readonly signatureHeader: string;
  listAdAccounts(cred: AdsCredential, accountRef: string): Promise<RemoteAdAccount[]>;
  getAdAccountHealth(cred: AdsCredential, q: AdsQuery): Promise<RemoteHealth>;
  listCampaignTree(cred: AdsCredential, q: AdsQuery & { cursor?: string }): Promise<AdsPage<RemoteCampaign>>;
  readResults(cred: AdsCredential, q: AdsQuery & { level: AdLevel; from: string; to: string; attributionModel: string }): Promise<{ rows: ResultRow[]; partial: boolean }>;
  validateLaunch(cred: AdsCredential, spec: LaunchSpec): Promise<ValidationOutcome>;
  launch(cred: AdsCredential, spec: LaunchSpec): Promise<LaunchOutcome>;
  listBoostablePosts(cred: AdsCredential, q: AdsQuery & { cursor?: string }): Promise<AdsPage<RemoteBoostablePost>>;
  listIdentities(cred: AdsCredential, q: AdsQuery): Promise<RemoteIdentity[]>;
  setStatus(cred: AdsCredential, spec: MutationSpec & { status: Extract<AdStatus, "active" | "paused"> }): Promise<void>;
  bulkSetStatus(cred: AdsCredential, spec: AdsQuery & { idempotencyKey: string; status: "active" | "paused"; items: { level: AdLevel; ref: string }[] }): Promise<void>;
  rename(cred: AdsCredential, spec: MutationSpec & { name: string }): Promise<void>;
  setBudget(cred: AdsCredential, spec: MutationSpec & { budgetAmount?: number; bidding?: { costType: string; unitCost?: number }; endDate?: string }): Promise<void>;
  remove(cred: AdsCredential, spec: MutationSpec): Promise<{ result: "deleted" | "archived" }>;
  listSharedBudgets(cred: AdsCredential, q: AdsQuery): Promise<{ ref: string; name: string; amount: number }[]>;
  searchTargeting(cred: AdsCredential, q: AdsQuery & { kind: string; query: string }): Promise<TargetingHit[]>;
  listAudiences(cred: AdsCredential, q: AdsQuery): Promise<RemoteAudience[]>;
  createLeadForm(cred: AdsCredential, q: AdsQuery & { idempotencyKey: string; name: string; consentText: string; privacyUrl: string; questions: string[] }): Promise<RemoteLeadForm>;
  listLeadForms(cred: AdsCredential, q: AdsQuery): Promise<RemoteLeadForm[]>;
  listLeads(cred: AdsCredential, q: AdsQuery & { formRef?: string; cursor?: string }): Promise<AdsPage<RemoteLead>>;
  listConversionDestinations(cred: AdsCredential, q: AdsQuery): Promise<RemoteConversionDestination[]>;
  /** Hashed identifiers only, idempotent per batch key. Hard-off: only the fake accepts it, and only when a test allows it. */
  sendConversionEvents(cred: AdsCredential, batch: ConversionEventBatch): Promise<{ accepted: number }>;
  createCustomerListAudience(cred: AdsCredential, q: AdsQuery & { idempotencyKey: string; name: string }): Promise<RemoteAudience>;
  /** Uploads hashed customer-list members. Hard-off like every other send. */
  uploadAudienceMembers(cred: AdsCredential, spec: AudienceUploadSpec): Promise<{ received: number }>;
  /** Constant-time check of the delivery signature against every accepted secret. */
  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]): boolean;
  /** Returns null for a body that is not a recognised event. */
  parseWebhookEvent(rawBody: string): AdsEvent | null;
}
