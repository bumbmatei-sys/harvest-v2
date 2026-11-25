import type { AdLevel, AdStatus } from "../../lib/ads/ads";
import { launchPayload, type LaunchKind } from "../../lib/ads/ads";
import type {
  LoosePayload, AdsCredential, AudienceUploadSpec, AdsEvent, AdsPage, AdsQuery, ConversionEventBatch, LaunchOutcome, LaunchSpec, MutationSpec, RemoteAd, RemoteAdAccount, RemoteAdSet, RemoteAudience, RemoteBoostablePost,
  RemoteCampaign, RemoteConversionDestination, RemoteHealth, RemoteIdentity, RemoteLead, RemoteLeadForm, ResultRow, TargetingHit, ValidationOutcome,
} from "./contract";
import { AdsProviderError, type AdsProvider, type AdsProviderErrorCode } from "./port";
import { parseAdsEvent } from "./webhook-parse";
import { signBody, verifyBodySignature } from "../social/webhook-signature";

export type FakeCall = { method: string; key: string | null };
type Remote = { account: RemoteAdAccount; campaigns: RemoteCampaign[]; results: ResultRow[]; leads: RemoteLead[]; forms: RemoteLeadForm[]; audiences: RemoteAudience[];
  posts: RemoteBoostablePost[]; identities: RemoteIdentity[]; destinations: RemoteConversionDestination[]; sharedBudgets: { ref: string; name: string; amount: number }[]; health: RemoteHealth };

/**
 * Deterministic in-memory Ads provider for tests and the non-production gate. It never touches a network and has no persistence.
 * `fail(method, code, times)` injects errors; `ambiguousOnce(method)` applies the change and then throws UNAVAILABLE, like a timeout after the provider acted.
 */
export class FakeAdsProvider implements AdsProvider {
  readonly id = "fake" as const;
  readonly signatureHeader = "x-fake-signature";
  readonly calls: FakeCall[] = [];
  /** Real network calls never exist here; this counts conversion sends that were refused. */
  readonly refusedConversionSends: ConversionEventBatch[] = [];
  /** Conversion batches and audience members the fake accepted (hashes only), for tests. Off unless a test allows sends. */
  readonly conversionSends: ConversionEventBatch[] = [];
  readonly audienceMembers = new Map<string, import("./contract").HashedIdentity[]>();
  allowSends = false;
  readonly remotes = new Map<string, Remote>();
  private readonly byKey = new Map<string, unknown>();
  private readonly failures = new Map<string, { code: AdsProviderErrorCode; times: number }>();
  private readonly ambiguous = new Set<string>();
  private counter = 0;
  constructor(readonly validSecret = "fake-ads-credential") {}
  fail(method: string, code: AdsProviderErrorCode, times = 1) { this.failures.set(method, { code, times }); }
  ambiguousOnce(method: string) { this.ambiguous.add(method); }
  /** Adds a synthetic ad account under a social connection's provider account. */
  addAccount(accountRef: string, account: Partial<RemoteAdAccount> & { ref: string }) {
    const full: RemoteAdAccount = { network: "meta", name: `Ad account ${account.ref}`, currency: "USD", timezone: "America/Chicago", status: "active", ...account };
    this.remotes.set(this.k(accountRef, full.ref), { account: full, campaigns: [], results: [], leads: [], forms: [], audiences: [], posts: [], identities: [], destinations: [], sharedBudgets: [],
      health: { status: full.status, checks: { account_status: { state: "ok" }, payment_method: { state: "ok" }, spend_limit: { state: "unknown" } }, newestPixelEventAt: null, lastRefusal: null } });
    return full;
  }
  private k = (accountRef: string, adAccountRef: string) => `${accountRef}\u0000${adAccountRef}`;
  private enter(method: string, cred: AdsCredential, key: string | null = null) {
    this.calls.push({ method, key });
    if (cred.secret !== this.validSecret) throw new AdsProviderError("AUTH");
    const f = this.failures.get(method);
    if (f && f.times > 0) { f.times--; throw new AdsProviderError(f.code); }
  }
  private remote(q: AdsQuery) { const r = this.remotes.get(this.k(q.accountRef, q.adAccountRef)); if (!r) throw new AdsProviderError("NOT_FOUND"); return r; }
  private once<T>(key: string, method: string, make: () => T): T {
    if (this.byKey.has(`${method}:${key}`)) return this.byKey.get(`${method}:${key}`) as T;
    const value = make();
    this.byKey.set(`${method}:${key}`, value);
    if (this.ambiguous.delete(method)) throw new AdsProviderError("UNAVAILABLE");
    return value;
  }
  private nextRef(prefix: string) { return `${prefix}-${++this.counter}`; }
  private find(r: Remote, level: AdLevel, ref: string): { entity: { status: AdStatus; name: string; budgetAmount?: number | null; bidding?: unknown; endDate?: string | null }; ads?: unknown } {
    for (const c of r.campaigns) {
      if (level === "campaign" && c.ref === ref) return { entity: c };
      for (const s of c.adSets) {
        if (level === "adset" && s.ref === ref) return { entity: s };
        for (const a of s.ads) if (level === "ad" && a.ref === ref) return { entity: a as never };
      }
    }
    throw new AdsProviderError("NOT_FOUND");
  }
  async listAdAccounts(cred: AdsCredential, accountRef: string): Promise<RemoteAdAccount[]> {
    this.enter("listAdAccounts", cred);
    return [...this.remotes.entries()].filter(([k]) => k.startsWith(`${accountRef}\u0000`)).map(([, r]) => r.account);
  }
  async getAdAccountHealth(cred: AdsCredential, q: AdsQuery): Promise<RemoteHealth> { this.enter("getAdAccountHealth", cred); return this.remote(q).health; }
  async listCampaignTree(cred: AdsCredential, q: AdsQuery & { cursor?: string }): Promise<AdsPage<RemoteCampaign>> {
    this.enter("listCampaignTree", cred);
    const all = this.remote(q).campaigns, start = q.cursor ? Number(q.cursor) : 0;
    if (!Number.isInteger(start) || start < 0) throw new AdsProviderError("INVALID_REQUEST");
    return { items: all.slice(start, start + 25), nextCursor: start + 25 < all.length ? String(start + 25) : null };
  }
  async readResults(cred: AdsCredential, q: AdsQuery & { level: AdLevel; from: string; to: string; attributionModel: string }) {
    this.enter("readResults", cred);
    return { rows: this.remote(q).results.filter(r => r.level === q.level && r.day >= q.from && r.day <= q.to), partial: false };
  }
  async validateLaunch(cred: AdsCredential, spec: LaunchSpec): Promise<ValidationOutcome> {
    this.enter("validateLaunch", cred);
    this.remote(spec);
    try { launchPayload(spec.kind as LaunchKind, spec.payload); return { ok: true, problems: [] }; } catch { return { ok: false, problems: ["payload_invalid"] }; }
  }
  async launch(cred: AdsCredential, spec: LaunchSpec): Promise<LaunchOutcome> {
    this.enter("launch", cred, spec.idempotencyKey);
    const r = this.remote(spec);
    if (spec.validateOnly) return { campaignRef: null, adSetRef: null, adRef: null };
    return this.once(spec.idempotencyKey, "launch", () => {
      const p = spec.payload as LoosePayload;
      const status: AdStatus = p.status === "active" ? "active" : "paused";
      const ad = (name: string): RemoteAd => ({ ref: this.nextRef("ad"), name, status, format: p.creative?.format ?? "image", creativeRef: null, sourcePostRef: spec.kind === "boost" ? String(p.postRef) : null,
        leadFormRef: null, review: "in_review", reviewReason: null, deliveryIssue: null });
      if (spec.kind === "add_ad") {
        const set = r.campaigns.flatMap(c => c.adSets).find(s => s.ref === spec.targetAdSetRef);
        if (!set) throw new AdsProviderError("NOT_FOUND");
        const created = ad(String(p.name)); set.ads.push(created);
        return { campaignRef: null, adSetRef: set.ref, adRef: created.ref };
      }
      if (spec.kind === "boost" && spec.targetAdSetRef) {
        const camp = r.campaigns.find(c => c.adSets.some(s => s.ref === spec.targetAdSetRef));
        const set = camp?.adSets.find(s => s.ref === spec.targetAdSetRef);
        if (!camp || !set) throw new AdsProviderError("NOT_FOUND");
        const created = ad(String(p.name)); set.ads.push(created);
        return { campaignRef: camp.ref, adSetRef: set.ref, adRef: created.ref };
      }
      const created = ad(String(p.name));
      const set: RemoteAdSet = { ref: this.nextRef("adset"), name: String(p.name), status, budgetAmount: null, budgetType: null, startDate: p.startDate ?? null, endDate: p.endDate ?? null, bidding: p.bidding ?? null,
        targeting: p.targeting ?? {}, ads: [created] };
      const camp: RemoteCampaign = { ref: this.nextRef("camp"), name: String(p.name), goal: p.goal, status, budgetAmount: p.budgetAmount ?? null, budgetType: p.budgetType ?? "daily",
        budgetLevel: p.budgetLevel ?? "campaign", sharedBudgetRef: null, startDate: p.startDate ?? null, endDate: p.endDate ?? null, bidding: p.bidding ?? null,
        specialAdCategories: p.specialAdCategories ?? [], attributionModel: p.attributionModel ?? "default", adSets: [set] };
      if (camp.budgetLevel === "adset") { set.budgetAmount = camp.budgetAmount; set.budgetType = camp.budgetType; camp.budgetAmount = null; }
      r.campaigns.push(camp);
      return { campaignRef: camp.ref, adSetRef: set.ref, adRef: created.ref };
    });
  }
  async listBoostablePosts(cred: AdsCredential, q: AdsQuery & { cursor?: string }): Promise<AdsPage<RemoteBoostablePost>> { this.enter("listBoostablePosts", cred); return { items: this.remote(q).posts, nextCursor: null }; }
  async listIdentities(cred: AdsCredential, q: AdsQuery): Promise<RemoteIdentity[]> { this.enter("listIdentities", cred); return this.remote(q).identities; }
  async setStatus(cred: AdsCredential, spec: MutationSpec & { status: "active" | "paused" }) {
    this.enter("setStatus", cred, spec.idempotencyKey);
    this.once(spec.idempotencyKey, "setStatus", () => { this.find(this.remote(spec), spec.level, spec.ref).entity.status = spec.status; return true; });
  }
  async bulkSetStatus(cred: AdsCredential, spec: AdsQuery & { idempotencyKey: string; status: "active" | "paused"; items: { level: AdLevel; ref: string }[] }) {
    this.enter("bulkSetStatus", cred, spec.idempotencyKey);
    const r = this.remote(spec);
    this.once(spec.idempotencyKey, "bulkSetStatus", () => { for (const i of spec.items) this.find(r, i.level, i.ref).entity.status = spec.status; return true; });
  }
  async rename(cred: AdsCredential, spec: MutationSpec & { name: string }) {
    this.enter("rename", cred, spec.idempotencyKey);
    this.once(spec.idempotencyKey, "rename", () => { this.find(this.remote(spec), spec.level, spec.ref).entity.name = spec.name; return true; });
  }
  async setBudget(cred: AdsCredential, spec: MutationSpec & { budgetAmount?: number; bidding?: { costType: string; unitCost?: number }; endDate?: string }) {
    this.enter("setBudget", cred, spec.idempotencyKey);
    this.once(spec.idempotencyKey, "setBudget", () => {
      const e = this.find(this.remote(spec), spec.level, spec.ref).entity;
      if (spec.budgetAmount !== undefined) e.budgetAmount = spec.budgetAmount;
      if (spec.bidding) e.bidding = spec.bidding;
      if (spec.endDate) e.endDate = spec.endDate;
      return true;
    });
  }
  async remove(cred: AdsCredential, spec: MutationSpec): Promise<{ result: "deleted" | "archived" }> {
    this.enter("remove", cred, spec.idempotencyKey);
    return this.once(spec.idempotencyKey, "remove", () => {
      const r = this.remote(spec); const entity = this.find(r, spec.level, spec.ref).entity;
      // Some networks archive instead of deleting: campaigns archive here, ad sets and ads delete.
      const result = spec.level === "campaign" ? "archived" as const : "deleted" as const;
      entity.status = result; return { result };
    });
  }
  async listSharedBudgets(cred: AdsCredential, q: AdsQuery) { this.enter("listSharedBudgets", cred); return this.remote(q).sharedBudgets; }
  async searchTargeting(cred: AdsCredential, q: AdsQuery & { kind: string; query: string }): Promise<TargetingHit[]> {
    this.enter("searchTargeting", cred); this.remote(q);
    return [{ id: `${q.kind}-1`, name: `${q.query} one`, kind: q.kind }, { id: `${q.kind}-2`, name: `${q.query} two`, kind: q.kind }];
  }
  async listAudiences(cred: AdsCredential, q: AdsQuery) { this.enter("listAudiences", cred); return this.remote(q).audiences; }
  async createLeadForm(cred: AdsCredential, q: AdsQuery & { idempotencyKey: string; name: string; consentText: string; privacyUrl: string; questions: string[] }): Promise<RemoteLeadForm> {
    this.enter("createLeadForm", cred, q.idempotencyKey);
    const r = this.remote(q);
    return this.once(q.idempotencyKey, "createLeadForm", () => { const f: RemoteLeadForm = { ref: this.nextRef("form"), name: q.name, status: "active", questions: q.questions, consentText: q.consentText }; r.forms.push(f); return f; });
  }
  async listLeadForms(cred: AdsCredential, q: AdsQuery) { this.enter("listLeadForms", cred); return this.remote(q).forms; }
  async listLeads(cred: AdsCredential, q: AdsQuery & { formRef?: string; cursor?: string }): Promise<AdsPage<RemoteLead>> {
    this.enter("listLeads", cred);
    return { items: this.remote(q).leads.filter(l => !q.formRef || l.formRef === q.formRef), nextCursor: null };
  }
  async listConversionDestinations(cred: AdsCredential, q: AdsQuery) { this.enter("listConversionDestinations", cred); return this.remote(q).destinations; }
  async sendConversionEvents(cred: AdsCredential, batch: ConversionEventBatch): Promise<{ accepted: number }> {
    this.enter("sendConversionEvents", cred, batch.idempotencyKey);
    if (!this.allowSends) { this.refusedConversionSends.push(batch); throw new AdsProviderError("DISABLED"); }
    return this.once(batch.idempotencyKey, "sendConversionEvents", () => { this.conversionSends.push(batch); return { accepted: batch.events.length }; });
  }
  async createCustomerListAudience(cred: AdsCredential, q: AdsQuery & { idempotencyKey: string; name: string }): Promise<RemoteAudience> {
    this.enter("createCustomerListAudience", cred, q.idempotencyKey);
    const r = this.remote(q);
    return this.once(q.idempotencyKey, "createCustomerListAudience", () => { const a: RemoteAudience = { ref: this.nextRef("aud"), kind: "customer_list", name: q.name, sizeEstimate: 0, spec: null }; r.audiences.push(a); return a; });
  }
  async uploadAudienceMembers(cred: AdsCredential, spec: AudienceUploadSpec): Promise<{ received: number }> {
    this.enter("uploadAudienceMembers", cred, spec.idempotencyKey);
    if (!this.allowSends) throw new AdsProviderError("DISABLED");
    return this.once(spec.idempotencyKey, "uploadAudienceMembers", () => { this.audienceMembers.set(spec.audienceRef, [...(this.audienceMembers.get(spec.audienceRef) ?? []), ...spec.members]); return { received: spec.members.length }; });
  }
  verifyWebhook(rawBody: string, signature: string | null, secrets: readonly string[]) { return verifyBodySignature(rawBody, signature, secrets); }
  parseWebhookEvent(rawBody: string): AdsEvent | null { return parseAdsEvent(rawBody); }
  /** Test helper: a signed delivery body in the normalised wire shape. */
  static signed(event: Record<string, unknown>, secret: string) { const raw = JSON.stringify(event); return { raw, signature: signBody(raw, secret) }; }
}
