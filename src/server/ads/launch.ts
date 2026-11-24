import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsAds, adsAdSets, adsCampaigns, adsLaunchRequests, adsLeadForms } from "../../db/schema";
import { isRefusedCategory, launchKinds, launchPayload, versionInput, uuidKey, type LaunchKind } from "../../lib/ads/ads";
import { audit, digest, failureCode, invalid, isAmbiguous, loadAccount, parse, providerAccess, recordId, stale, unavailable, withAds } from "./access";
import type { LaunchOutcome, LaunchSpec, LoosePayload } from "./contract";
import { AdsProviderError } from "./port";
import type { AdsDeps } from "./registry";
import { AccessError } from "../permissions";
import { message } from "../../i18n/messages";

type Request = typeof adsLaunchRequests.$inferSelect;
export const launchView = (r: Request) => ({ id: r.id, adAccountId: r.adAccountId, kind: r.kind, status: r.status, payload: r.payload, validation: r.validation, reviewedAt: r.reviewedAt?.toISOString() ?? null,
  resultCampaignId: r.resultCampaignId, resultAdSetId: r.resultAdSetId, resultAdId: r.resultAdId, errorCode: r.errorCode, version: r.version, createdAt: r.createdAt.toISOString() });
const refusedPolicy = () => invalid("POLICY_REFUSED");
const ownerOnlyRaw = (payload: Record<string, unknown>, role: string) => {
  if (payload.rawTargeting !== undefined && role !== "owner") throw new AccessError(403, message("Errors.youDoNotHavePermissionToDoThat"));
};
const createInput = z.object({ kind: z.enum(launchKinds), payload: z.record(z.string(), z.unknown()) }).strict();
const bodyOf = (kind: LaunchKind, payload: unknown) => { try { return launchPayload(kind, payload) as Record<string, unknown> & { adAccountId: string }; } catch { throw invalid("ADS_INVALID_INPUT", { fields: ["payload"] }); } };
const hashOf = (r: Pick<Request, "kind" | "adAccountId" | "payload">) => digest({ a: r.adAccountId, k: r.kind, p: r.payload });

async function loadRequest(tx: Transaction, tenant: string, id: string, lock = false) {
  const q = tx.select().from(adsLaunchRequests).where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, recordId(id))));
  const [row] = await (lock ? q.$dynamic().for("update") : q);
  if (!row) throw unavailable();
  return row;
}

export async function createLaunchRequest(db: Database, user: string, workspace: string, data: unknown, deps: AdsDeps) {
  const input = parse(createInput, data);
  return withAds(db, user, workspace, deps, async (tx, tenant, role) => {
    const payload = bodyOf(input.kind, input.payload);
    ownerOnlyRaw(payload, role);
    await loadAccount(tx, tenant, payload.adAccountId);
    const [row] = await tx.insert(adsLaunchRequests).values({ tenantId: tenant, adAccountId: payload.adAccountId, kind: input.kind, payload, createdBy: user }).returning();
    await audit(tx, tenant, user, "launch_draft", row.id, { kind: input.kind });
    return { request: launchView(row) };
  });
}

export async function updateLaunchRequest(db: Database, user: string, workspace: string, id: string, data: unknown, deps: AdsDeps) {
  const input = parse(z.object({ payload: z.record(z.string(), z.unknown()), version: versionInput }).strict(), data);
  return withAds(db, user, workspace, deps, async (tx, tenant, role) => {
    const row = await loadRequest(tx, tenant, id, true);
    if (row.version !== input.version) throw stale();
    if (row.status !== "draft" && row.status !== "failed" && row.status !== "reviewed") throw invalid("REQUEST_LOCKED");
    const payload = bodyOf(row.kind as LaunchKind, input.payload);
    ownerOnlyRaw(payload, role);
    if (payload.adAccountId !== row.adAccountId) throw invalid("ACCOUNT_CHANGE_NOT_ALLOWED");
    // Any edit drops validation and review: the reviewer approved exactly what they saw.
    const [updated] = await tx.update(adsLaunchRequests).set({ payload, status: "draft", validation: null, reviewHash: null, reviewedBy: null, reviewedAt: null, errorCode: null, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id))).returning();
    await audit(tx, tenant, user, "launch_edit", row.id);
    return { request: launchView(updated) };
  });
}

export async function listLaunchRequests(db: Database, user: string, workspace: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ requests: (await tx.select().from(adsLaunchRequests).where(eq(adsLaunchRequests.tenantId, tenant)).orderBy(desc(adsLaunchRequests.createdAt)).limit(100)).map(launchView) }));
}
export async function getLaunchRequest(db: Database, user: string, workspace: string, id: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => ({ request: launchView(await loadRequest(tx, tenant, id)) }));
}
export async function cancelLaunchRequest(db: Database, user: string, workspace: string, id: string, deps: AdsDeps) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const row = await loadRequest(tx, tenant, id, true);
    if (!["draft", "reviewed", "failed"].includes(row.status)) throw invalid("REQUEST_LOCKED");
    await tx.update(adsLaunchRequests).set({ status: "cancelled", version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` }).where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id)));
    await audit(tx, tenant, user, "launch_cancel", row.id);
    return { cancelled: true };
  });
}

/** Maps Harvest ids in a payload to provider references. Everything must belong to the same ad account. */
async function toSpec(tx: Transaction, tenant: string, row: Request, query: { accountRef: string; adAccountRef: string }, key: string, validateOnly: boolean): Promise<LaunchSpec> {
  const payload = JSON.parse(JSON.stringify(row.payload)) as LoosePayload;
  const spec: LaunchSpec = { ...query, idempotencyKey: key, kind: row.kind as LaunchKind, payload, validateOnly };
  const adSetId: string | undefined = row.kind === "add_ad" ? payload.adSetId : payload.existingAdSetId;
  if (adSetId) {
    const [set] = await tx.select({ ref: adsAdSets.externalRef, status: adsAdSets.status }).from(adsAdSets).where(and(eq(adsAdSets.tenantId, tenant), eq(adsAdSets.id, adSetId), eq(adsAdSets.adAccountId, row.adAccountId)));
    if (!set?.ref || set.status === "deleted" || set.status === "archived") throw invalid("AD_SET_UNAVAILABLE");
    spec.targetAdSetRef = set.ref;
  }
  const formId: string | undefined = payload.creative?.leadFormId;
  if (formId) {
    const [form] = await tx.select({ ref: adsLeadForms.externalRef, status: adsLeadForms.status }).from(adsLeadForms).where(and(eq(adsLeadForms.tenantId, tenant), eq(adsLeadForms.id, formId), eq(adsLeadForms.adAccountId, row.adAccountId)));
    if (!form?.ref || form.status !== "active") throw invalid("LEAD_FORM_UNAVAILABLE");
    payload.creative.leadFormRef = form.ref; delete payload.creative.leadFormId;
  }
  return spec;
}

/** Validate only (dry run). Nothing is created at the provider. */
export async function validateLaunchRequest(db: Database, user: string, workspace: string, id: string, deps: AdsDeps) {
  const prepared = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const row = await loadRequest(tx, tenant, id);
    if (!["draft", "failed"].includes(row.status)) throw invalid("REQUEST_LOCKED");
    const ctx = await loadAccount(tx, tenant, row.adAccountId);
    const access = providerAccess(ctx, deps);
    return { row, access, spec: await toSpec(tx, tenant, row, access.query, row.id, true) };
  });
  const problems: string[] = [];
  if (isRefusedCategory(prepared.row.payload as { specialAdCategories?: string[] })) problems.push("policy_refused");
  let ok = problems.length === 0;
  if (ok) {
    try { const r = await prepared.access.provider.validateLaunch(prepared.access.credential, prepared.spec); ok = r.ok; problems.push(...r.problems.slice(0, 20)); }
    catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
  }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [updated] = await tx.update(adsLaunchRequests).set({ validation: { ok, problems }, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, prepared.row.id), eq(adsLaunchRequests.version, prepared.row.version))).returning();
    if (!updated) throw stale();
    return { request: launchView(updated) };
  });
}

/** The review gate: a person approves the exact validated payload. Policy-refused ads can never be reviewed. */
export async function reviewLaunchRequest(db: Database, user: string, workspace: string, id: string, data: unknown, deps: AdsDeps) {
  const { version } = parse(z.object({ version: versionInput }).strict(), data);
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const row = await loadRequest(tx, tenant, id, true);
    if (row.version !== version) throw stale();
    if (row.status !== "draft") throw invalid("REQUEST_LOCKED");
    if (isRefusedCategory(row.payload as { specialAdCategories?: string[] })) throw refusedPolicy();
    if (!row.validation?.ok) throw invalid("VALIDATION_REQUIRED");
    const [updated] = await tx.update(adsLaunchRequests).set({ status: "reviewed", reviewHash: hashOf(row), reviewedBy: user, reviewedAt: sql`now()`, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id))).returning();
    await audit(tx, tenant, user, "launch_review", row.id, { kind: row.kind });
    return { request: launchView(updated) };
  });
}

const launchInput = z.object({ idempotencyKey: uuidKey, version: versionInput.optional() }).strict();
/**
 * Launch. The idempotency key is bound to the request on the first attempt. A timeout after the provider may have acted leaves the request `ambiguous`; the retry must use the SAME key,
 * which the provider answers with the original result, so a second campaign is never created. The provider is called with no transaction open.
 */
export async function launchRequest(db: Database, user: string, workspace: string, id: string, data: unknown, deps: AdsDeps): Promise<{ request: ReturnType<typeof launchView>; replayed: boolean }> {
  const input = parse(launchInput, data);
  const claim = await withAds(db, user, workspace, deps, async (tx, tenant): Promise<{ done: ReturnType<typeof launchView> } | { tenant: string; row: Request; access: ReturnType<typeof providerAccess>; spec: LaunchSpec }> => {
    const row = await loadRequest(tx, tenant, id, true);
    if (row.status === "launched" && row.idempotencyKey === input.idempotencyKey) return { done: launchView(row) };
    if (!["reviewed", "launching", "ambiguous"].includes(row.status)) throw invalid("NOT_REVIEWED");
    if (row.status === "reviewed" && input.version !== undefined && row.version !== input.version) throw stale();
    if (row.idempotencyKey && row.idempotencyKey !== input.idempotencyKey) throw stale("KEY_MISMATCH");
    if (row.reviewHash !== hashOf(row)) throw invalid("REVIEW_MISMATCH");
    if (isRefusedCategory(row.payload as { specialAdCategories?: string[] })) throw refusedPolicy();
    const ctx = await loadAccount(tx, tenant, row.adAccountId, true);
    if (ctx.account.status !== "active") throw invalid("ACCOUNT_NOT_ACTIVE");
    const access = providerAccess(ctx, deps);
    const spec = await toSpec(tx, tenant, row, access.query, input.idempotencyKey, false);
    try {
      await tx.update(adsLaunchRequests).set({ status: "launching", idempotencyKey: input.idempotencyKey, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` }).where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id)));
    } catch (error) { if ((error as { code?: string }).code === "23505" || (error as { cause?: { code?: string } }).cause?.code === "23505") throw stale("KEY_IN_USE"); throw error; }
    await audit(tx, tenant, user, "launch_requested", row.id, { kind: row.kind });
    return { tenant, row, access, spec };
  });
  if ("done" in claim) return { request: claim.done, replayed: true };
  let outcome: LaunchOutcome | null = null, code: string | null = null, ambiguous = false;
  try { outcome = await claim.access.provider.launch(claim.access.credential, claim.spec); }
  catch (error) { code = failureCode(error); ambiguous = isAmbiguous(error); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const row = claim.row;
    if (!outcome) {
      const [updated] = await tx.update(adsLaunchRequests).set({ status: ambiguous ? "ambiguous" : "failed", errorCode: code, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id))).returning();
      await audit(tx, tenant, user, "launch_outcome", row.id, { kind: row.kind, outcome: ambiguous ? "ambiguous" : "failed", code: code ?? "ERROR" });
      return { request: launchView(updated), replayed: false };
    }
    const ids = await recordLaunched(tx, tenant, row, outcome);
    const [updated] = await tx.update(adsLaunchRequests).set({ status: "launched", errorCode: null, resultCampaignId: ids.campaignId, resultAdSetId: ids.adSetId, resultAdId: ids.adId, version: sql`${adsLaunchRequests.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(adsLaunchRequests.tenantId, tenant), eq(adsLaunchRequests.id, row.id))).returning();
    await audit(tx, tenant, user, "launch_outcome", row.id, { kind: row.kind, outcome: "launched" });
    return { request: launchView(updated), replayed: false };
  });
}

async function recordLaunched(tx: Transaction, tenant: string, row: Request, o: LaunchOutcome) {
  const p = row.payload as LoosePayload, account = row.adAccountId;
  const status = p.status === "active" ? "active" : "paused";
  let campaignId: string | null = null, adSetId: string | null = null, adId: string | null = null;
  if (row.kind === "campaign" || (row.kind === "boost" && !p.existingAdSetId)) {
    const budgetOnSet = p.budgetLevel === "adset";
    const [c] = await tx.insert(adsCampaigns).values({ tenantId: tenant, adAccountId: account, externalRef: o.campaignRef, name: p.name, goal: p.goal, status, budgetAmount: budgetOnSet ? null : p.budgetAmount, budgetType: p.budgetType ?? "daily",
      budgetLevel: p.budgetLevel ?? "campaign", startDate: p.startDate ?? null, endDate: p.endDate ?? null, bidding: p.bidding ?? null, specialAdCategories: p.specialAdCategories ?? [], attributionModel: p.attributionModel ?? "default", syncedAt: sql`now()` })
      .onConflictDoNothing().returning({ id: adsCampaigns.id });
    campaignId = c?.id ?? (await tx.select({ id: adsCampaigns.id }).from(adsCampaigns).where(and(eq(adsCampaigns.tenantId, tenant), eq(adsCampaigns.adAccountId, account), eq(adsCampaigns.externalRef, o.campaignRef!))))[0].id;
    const [s] = await tx.insert(adsAdSets).values({ tenantId: tenant, adAccountId: account, campaignId, externalRef: o.adSetRef, name: p.name, status, budgetAmount: budgetOnSet ? p.budgetAmount : null, budgetType: budgetOnSet ? p.budgetType : null,
      startDate: p.startDate ?? null, endDate: p.endDate ?? null, bidding: p.bidding ?? null, targeting: p.targeting ?? {}, rawTargeting: p.rawTargeting ?? null, syncedAt: sql`now()` }).onConflictDoNothing().returning({ id: adsAdSets.id });
    adSetId = s?.id ?? (await tx.select({ id: adsAdSets.id }).from(adsAdSets).where(and(eq(adsAdSets.tenantId, tenant), eq(adsAdSets.adAccountId, account), eq(adsAdSets.externalRef, o.adSetRef!))))[0].id;
  } else {
    const [s] = await tx.select({ id: adsAdSets.id, campaignId: adsAdSets.campaignId }).from(adsAdSets).where(and(eq(adsAdSets.tenantId, tenant), eq(adsAdSets.adAccountId, account), eq(adsAdSets.externalRef, o.adSetRef!)));
    if (!s) throw invalid("AD_SET_UNAVAILABLE");
    adSetId = s.id; campaignId = s.campaignId;
  }
  const creative = p.creative as { format?: string; leadFormId?: string } | undefined;
  const [a] = await tx.insert(adsAds).values({ tenantId: tenant, adAccountId: account, campaignId: campaignId!, adSetId: adSetId!, externalRef: o.adRef, name: p.name, status, format: creative?.format ?? "image",
    sourcePostRef: row.kind === "boost" ? String(p.postRef) : null, leadFormId: creative?.leadFormId ?? null, reviewStatus: "in_review", syncedAt: sql`now()` }).onConflictDoNothing().returning({ id: adsAds.id });
  adId = a?.id ?? null;
  return { campaignId, adSetId, adId };
}
void AdsProviderError;
