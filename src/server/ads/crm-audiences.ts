import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsAudiences, adsAudienceUploads, contactConsents, contactIdentifiers, contacts } from "../../db/schema";
import { audienceUploadInput, customerAudienceInput, isEeaUkChPhone, normaliseEmail, normalisePhone, uuidKey } from "../../lib/ads/ads";
import type { ConsentChannel } from "../../lib/consent-purposes";
import { mayContact } from "../consent-gate";
import { audit, derivedKey, failureCode, invalid, loadAccount, parse, providerAccess, recordId, stale, unavailable, withAds } from "./access";
import type { HashedIdentity } from "./contract";
import { adsFeature, type AdsDeps } from "./registry";

// CRM people as an ad audience. Hard-off (ADS_AUDIENCE_UPLOAD_ENABLED = false). Founder decision 25 Nov: only people with a valid MARKETING consent, hashed identifiers only, suppressed and
// erased people excluded, every upload audited. Nothing here stores a hash or a person: the upload record keeps counts and reasons only.
const MAX_PEOPLE = 5_000;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const hashedIdentity = (email: string | null, phone: string | null): HashedIdentity => ({ ...(email ? { email: sha(normaliseEmail(email)) } : {}), ...(phone ? { phone: sha(normalisePhone(phone)) } : {}) });
const requireOn = (deps: AdsDeps) => { if (!adsFeature(deps, "audienceUpload")) throw unavailable(); };
export type Eligibility = { members: HashedIdentity[]; eligible: number; excluded: Record<string, number> };

/**
 * Who may be in an audience right now, decided at call time from the consent ledger (never from a stored flag): the single consent gate (`mayContact`, purpose marketing; a
 * withdrawal on any channel blocks), erased people never, and for a phone number in the EEA, the UK or Switzerland a grant must also carry an explicit notice version (not legacy history).
 */
export async function computeEligibility(tx: Transaction, tenant: string): Promise<Eligibility> {
  const people = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenant), isNull(contacts.erasedAt))).orderBy(asc(contacts.id)).limit(MAX_PEOPLE + 1);
  const excluded: Record<string, number> = {}; const members: HashedIdentity[] = [];
  const skip = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const identifiers = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenant), inArray(contactIdentifiers.contactId, people.slice(0, MAX_PEOPLE).map(p => p.id).length ? people.slice(0, MAX_PEOPLE).map(p => p.id) : [recordId("00000000-0000-4000-8000-000000000000")])));
  const byPerson = new Map<string, { email: string | null; phone: string | null }>();
  for (const i of identifiers) { const e = byPerson.get(i.contactId) ?? { email: null, phone: null }; if (i.kind === "email") e.email = i.value; if (i.kind === "phone") e.phone = i.value; byPerson.set(i.contactId, e); }
  if (people.length > MAX_PEOPLE) skip("over_limit");
  for (const person of people.slice(0, MAX_PEOPLE)) {
    const id = byPerson.get(person.id);
    if (!id || (!id.email && !id.phone)) { skip("no_identifier"); continue; }
    const channel: ConsentChannel = id.email ? "email" : "sms";
    const decision = await mayContact(tx, tenant, person.id, "marketing", channel);
    if (!decision.allowed) { skip(decision.reason); continue; }
    if (isEeaUkChPhone(id.phone)) {
      const [row] = await tx.select({ notice: contactConsents.noticeVersion }).from(contactConsents).where(and(eq(contactConsents.tenantId, tenant), eq(contactConsents.id, decision.consentId)));
      if (!row || row.notice === "legacy-unversioned") { skip("region_consent_not_explicit"); continue; }
    }
    members.push(hashedIdentity(id.email, id.phone));
  }
  return { members, eligible: members.length, excluded };
}

/** Counts only, so an owner can see how many people an upload would include and why others are left out. Sends nothing. */
export async function previewAudienceUpload(db: Database, user: string, workspace: string, deps: AdsDeps) {
  requireOn(deps);
  return withAds(db, user, workspace, deps, async (tx, tenant) => { const { eligible, excluded } = await computeEligibility(tx, tenant); return { eligible, excluded }; });
}

/** Creates an empty customer-list audience at the provider and records it as a read-model row. */
export async function createCustomerAudience(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps) {
  requireOn(deps);
  const input = parse(customerAudienceInput, raw);
  const prepared = await withAds(db, user, workspace, deps, async (tx, tenant) => { const ctx = await loadAccount(tx, tenant, input.adAccountId); return { ctx, access: providerAccess(ctx, deps) }; });
  let remote; try { remote = await prepared.access.provider.createCustomerListAudience(prepared.access.credential, { ...prepared.access.query, idempotencyKey: input.idempotencyKey, name: input.name }); } catch (error) { throw invalid(`PROVIDER_${failureCode(error)}`); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [row] = await tx.insert(adsAudiences).values({ tenantId: tenant, adAccountId: input.adAccountId, externalRef: remote.ref, kind: "customer_list", name: input.name, sizeEstimate: 0, syncedAt: sql`now()` })
      .onConflictDoUpdate({ target: [adsAudiences.tenantId, adsAudiences.adAccountId, adsAudiences.externalRef], set: { name: input.name } }).returning({ id: adsAudiences.id });
    await audit(tx, tenant, user, "audience_create", row.id, { kind: "customer_list" });
    return { audienceId: row.id };
  });
}

/**
 * Uploads the eligible people to one customer-list audience. Eligibility is recomputed in the same transaction that records the request, immediately before the provider call. Idempotent per key:
 * a repeated key returns the stored counts for a finished upload, and re-sends under the same key after an ambiguous outcome. The hashes exist only in memory for the call.
 */
export async function uploadCrmAudience(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps) {
  requireOn(deps);
  const input = parse(audienceUploadInput, raw);
  const claim = await withAds(db, user, workspace, deps, async (tx, tenant) => {
    const [prior] = await tx.select().from(adsAudienceUploads).where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.idempotencyKey, input.idempotencyKey)));
    if (prior && prior.audienceId !== input.audienceId) throw stale("KEY_MISMATCH");
    if (prior?.status === "sent") return { done: { status: prior.status, eligible: prior.eligible, sent: prior.sent, excluded: prior.excluded } } as const;
    const ctx = await loadAccount(tx, tenant, input.adAccountId);
    if (ctx.account.status !== "active") throw invalid("ACCOUNT_NOT_ACTIVE");
    const [audience] = await tx.select().from(adsAudiences).where(and(eq(adsAudiences.tenantId, tenant), eq(adsAudiences.id, input.audienceId), eq(adsAudiences.adAccountId, ctx.account.id), eq(adsAudiences.kind, "customer_list")));
    if (!audience) throw unavailable();
    const { members, eligible, excluded } = await computeEligibility(tx, tenant);
    if (!members.length) throw invalid("NO_ELIGIBLE_PEOPLE", { excluded });
    const values = { eligible, excluded, status: "pending" as const, errorCode: null, updatedAt: new Date() };
    const [row] = prior
      ? await tx.update(adsAudienceUploads).set(values).where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.id, prior.id))).returning()
      : await tx.insert(adsAudienceUploads).values({ tenantId: tenant, adAccountId: input.adAccountId, audienceId: input.audienceId, idempotencyKey: input.idempotencyKey, requestedBy: user, ...values }).returning();
    await audit(tx, tenant, user, "audience_upload_requested", row.id, { eligible: String(eligible) });
    return { row, members, access: providerAccess(ctx, deps), audienceRef: audience.externalRef } as const;
  });
  if ("done" in claim) return { upload: claim.done, replayed: true };
  let sent = 0, code: string | null = null, ambiguous = false;
  try {
    for (let i = 0; i < claim.members.length; i += 1_000)
      sent += (await claim.access.provider.uploadAudienceMembers(claim.access.credential, { ...claim.access.query, audienceRef: claim.audienceRef, idempotencyKey: derivedKey(`${input.idempotencyKey}:${i}`), members: claim.members.slice(i, i + 1_000) })).received;
  } catch (error) { code = failureCode(error); ambiguous = code === "UNAVAILABLE"; }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const status = code === null ? "sent" as const : ambiguous ? "ambiguous" as const : "failed" as const;
    await tx.update(adsAudienceUploads).set({ status, sent, errorCode: code, updatedAt: new Date() }).where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.id, claim.row.id)));
    await audit(tx, tenant, user, "audience_upload_outcome", claim.row.id, { outcome: status, sent: String(sent), ...(code ? { code } : {}) });
    return { upload: { status, eligible: claim.row.eligible, sent, excluded: claim.row.excluded }, replayed: false };
  });
}
void z; void uuidKey;
