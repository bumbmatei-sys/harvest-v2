import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../../db/client";
import { adsAudiences, adsAudienceUploads, contactConsents, contactIdentifiers, contacts, crmSavedViews } from "../../db/schema";
import { audienceUploadInput, customerAudienceInput, isEeaUkChPhone, normaliseEmail, normalisePhone, uuidKey } from "../../lib/ads/ads";
import { viewState } from "../../lib/crm-fields";
import { peopleQuery } from "../contacts";
import { resolveState } from "../crm-filters";
import { mayContact } from "../consent-gate";
import { AccessError } from "../permissions";
import { audit, derivedKey, failureCode, invalid, loadAccount, parse, providerAccess, stale, unavailable, withAds, type AccountContext } from "./access";
import type { HashedIdentity } from "./contract";
import { adsFeature, type AdsDeps } from "./registry";

const MAX_PEOPLE = 5_000;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export const hashedIdentity = (email: string | null, phone: string | null): HashedIdentity => ({ ...(email ? { email: sha(normaliseEmail(email)) } : {}), ...(phone ? { phone: sha(normalisePhone(phone)) } : {}) });
const requireOn = (deps: AdsDeps) => { if (!adsFeature(deps, "audienceUpload")) throw unavailable(); };
const unavailableAudience = () => invalid("AUDIENCE_UNAVAILABLE");
const previewInput = z.object({ adAccountId: uuidKey, savedViewId: uuidKey });
export type Eligibility = { members: HashedIdentity[]; eligible: number; excluded: Record<string, number> };

const audienceFilterFields = new Set(["marketing", "email", "phone", "created", "updated"]);

async function audienceView(tx: Transaction, tenant: string, viewId: string): Promise<SQL | undefined> {
  // A ministry-wide audience must be reproducible by any owner or admin who can sync it.
  const [view] = await tx.select().from(crmSavedViews).where(and(eq(crmSavedViews.tenantId, tenant),
    eq(crmSavedViews.id, viewId), eq(crmSavedViews.objectType, "person"), isNull(crmSavedViews.ownerUserId))).for("share");
  const parsed = viewState.safeParse(view?.state);
  if (!parsed.success) return undefined;
  // Targeting cannot use pastoral provenance, custom field values, or free-text searches.
  const state = parsed.data;
  if (state.q || state.sources.length || state.filters.some(filter =>
    !audienceFilterFields.has(filter.field) ||
    ((filter.field === "email" || filter.field === "phone") && !["is_empty", "is_not_empty"].includes(filter.op)))) return undefined;
  try {
    // Saved display sort and columns do not change the audience membership.
    return peopleQuery(tx, tenant, resolveState("person", { ...state, sort: "name" }, []), [], false).where;
  } catch (error) {
    if (error instanceof AccessError && error.details?.reason === "invalid_view") return undefined;
    throw error;
  }
}

/**
 * Founder decision 28 Nov 2026: CRM-based audiences are for owners and admins only. The stored role decides, not the
 * effective Social role, so a collaborator with Social access gets the neutral 404. RLS enforces the same check.
 */
function withCrmAudience<T>(db: Database, user: string, workspace: string, deps: AdsDeps, run: (tx: Transaction, tenant: string) => Promise<T>) {
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const { rows: [staff] } = await tx.execute<{ allowed: boolean }>(sql`select public.ads_crm_audience_staff(${tenant}::uuid) as allowed`);
    if (!staff?.allowed) throw unavailable();
    return run(tx, tenant);
  });
}

function fakeAccess(ctx: AccountContext, deps: AdsDeps) {
  if (ctx.account.status !== "active" || ctx.connection.provider !== "fake") throw unavailableAudience();
  const access = providerAccess(ctx, deps);
  const minimum = access.provider.minimumAudienceSize(ctx.account.network);
  if (!Number.isSafeInteger(minimum) || minimum < 1 || minimum > MAX_PEOPLE) throw unavailableAudience();
  return { ...access, minimum };
}

/** Eligibility is decided against the live ledger. The contact lock serializes checks with consent and erasure writes during a sync. */
export async function computeEligibility(tx: Transaction, tenant: string, view?: SQL, lockContacts = false): Promise<Eligibility> {
  const query = tx.select({ id: contacts.id }).from(contacts)
    .where(and(eq(contacts.tenantId, tenant), isNull(contacts.erasedAt), view))
    .orderBy(asc(contacts.id)).limit(MAX_PEOPLE + 1);
  const people = await (lockContacts ? query.for("update") : query);
  const members: HashedIdentity[] = [];
  const excluded: Record<string, number> = {};
  const skip = (reason: string) => { excluded[reason] = (excluded[reason] ?? 0) + 1; };
  const ids = people.slice(0, MAX_PEOPLE).map(person => person.id);
  if (!ids.length) return { members, eligible: 0, excluded };
  const identifiers = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenant), inArray(contactIdentifiers.contactId, ids))).orderBy(asc(contactIdentifiers.id));
  const byPerson = new Map<string, { email: string | null; phone: string | null }>();
  for (const identifier of identifiers) {
    const entry = byPerson.get(identifier.contactId) ?? { email: null, phone: null };
    if (identifier.kind === "email") entry.email ??= identifier.value;
    if (identifier.kind === "phone") entry.phone ??= identifier.value;
    byPerson.set(identifier.contactId, entry);
  }
  if (people.length > MAX_PEOPLE) skip("over_limit");
  for (const id of ids) {
    const identity = byPerson.get(id);
    if (!identity || (!identity.email && !identity.phone)) { skip("no_identifier"); continue; }
    const emailConsent = identity.email && await mayContact(tx, tenant, id, "marketing", "email");
    const phoneConsent = identity.phone && await mayContact(tx, tenant, id, "marketing", "sms");
    const email = emailConsent && emailConsent.allowed ? identity.email : null;
    const phone = phoneConsent && phoneConsent.allowed ? identity.phone : null;
    const decision = emailConsent || phoneConsent;
    if ((!email && !phone) || !decision) {
      skip(decision && !decision.allowed ? decision.reason : "consent_missing");
      continue;
    }
    if (isEeaUkChPhone(identity.phone)) {
      const consentIds = [emailConsent, phoneConsent].flatMap(result => result && result.allowed ? [result.consentId] : []);
      const rows = await tx.select({ notice: contactConsents.noticeVersion }).from(contactConsents)
        .where(and(eq(contactConsents.tenantId, tenant), inArray(contactConsents.id, consentIds)));
      if (rows.length !== consentIds.length || rows.some(row => row.notice === "legacy-unversioned")) {
        skip("region_consent_not_explicit");
        continue;
      }
    }
    members.push(hashedIdentity(email, phone));
  }
  return { members, eligible: members.length, excluded };
}

export async function previewAudienceUpload(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps) {
  requireOn(deps);
  const input = parse(previewInput, raw);
  return withCrmAudience(db, user, workspace, deps, async (tx, tenant) => {
    const { minimum } = fakeAccess(await loadAccount(tx, tenant, input.adAccountId), deps);
    const view = await audienceView(tx, tenant, input.savedViewId);
    if (!view) throw unavailableAudience();
    const { eligible, excluded } = await computeEligibility(tx, tenant, view);
    if (eligible < minimum) throw unavailableAudience();
    return { eligible, excluded };
  });
}

export async function createCustomerAudience(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps) {
  requireOn(deps);
  const input = parse(customerAudienceInput, raw);
  return withCrmAudience(db, user, workspace, deps, async (tx, tenant) => {
    const ctx = await loadAccount(tx, tenant, input.adAccountId, true);
    const access = fakeAccess(ctx, deps);
    const view = await audienceView(tx, tenant, input.savedViewId);
    if (!view) throw unavailableAudience();
    const { eligible } = await computeEligibility(tx, tenant, view);
    if (eligible < access.minimum) throw unavailableAudience();
    let remote;
    try {
      remote = await access.provider.createCustomerListAudience(access.credential, { ...access.query, idempotencyKey: derivedKey(`audience:${tenant}:${ctx.account.id}:${input.idempotencyKey}`), name: input.name });
    } catch {
      throw unavailableAudience();
    }
    const [row] = await tx.insert(adsAudiences).values({ tenantId: tenant, adAccountId: input.adAccountId, externalRef: remote.ref,
      kind: "customer_list", name: input.name, crmManaged: true, crmSavedViewId: input.savedViewId, sizeEstimate: 0, syncedAt: sql`now()` })
      .onConflictDoNothing({ target: [adsAudiences.tenantId, adsAudiences.adAccountId, adsAudiences.externalRef] })
      .returning({ id: adsAudiences.id });
    if (row) {
      await audit(tx, tenant, user, "audience_create", row.id, { eligible: String(eligible) });
      return { audienceId: row.id };
    }
    const [existing] = await tx.select({ id: adsAudiences.id, viewId: adsAudiences.crmSavedViewId }).from(adsAudiences)
      .where(and(eq(adsAudiences.tenantId, tenant), eq(adsAudiences.adAccountId, input.adAccountId), eq(adsAudiences.externalRef, remote.ref)));
    if (existing?.viewId !== input.savedViewId) throw stale("KEY_MISMATCH");
    return { audienceId: existing.id };
  });
}

const claimLeaseMs = 60_000;

/** Each sync replaces the fake provider's whole remote list, including clearing a list that drops below the minimum. */
export async function uploadCrmAudience(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps) {
  requireOn(deps);
  const input = parse(audienceUploadInput, raw);
  const claim = await withCrmAudience(db, user, workspace, deps, async (tx, tenant) => {
    // The same request key can be submitted against different accounts. Serialize that check before taking account or audience locks.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ads-audience-upload:${tenant}:${input.idempotencyKey}`}, 0))`);
    const ctx = await loadAccount(tx, tenant, input.adAccountId, true);
    const access = fakeAccess(ctx, deps);
    const [audience] = await tx.select().from(adsAudiences).where(and(eq(adsAudiences.tenantId, tenant), eq(adsAudiences.id, input.audienceId),
      eq(adsAudiences.adAccountId, ctx.account.id), eq(adsAudiences.kind, "customer_list"), eq(adsAudiences.crmManaged, true))).for("update");
    if (!audience) throw unavailableAudience();
    // Outcome writers lock the upload row independently of the audience lock.
    const [pending] = await tx.select({ id: adsAudienceUploads.id, updatedAt: adsAudienceUploads.updatedAt }).from(adsAudienceUploads)
      .where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.audienceId, audience.id), eq(adsAudienceUploads.status, "pending")))
      .limit(1).for("update");
    const [prior] = await tx.select().from(adsAudienceUploads).where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.idempotencyKey, input.idempotencyKey)));
    if (prior && (prior.audienceId !== input.audienceId || prior.adAccountId !== input.adAccountId)) throw stale("KEY_MISMATCH");
    if (prior?.status === "sent") {
      const upload = prior.sent > 0 ? { status: prior.status, eligible: prior.eligible, sent: prior.sent, excluded: prior.excluded } : null;
      return { replay: true, upload } as const;
    }

    if (pending && pending.updatedAt.getTime() + claimLeaseMs > Date.now()) throw stale("AUDIENCE_UPLOAD_PENDING");
    if (pending && pending.id !== prior?.id) {
      // The expired attempt may have reached the provider. Close its claim without reassigning its key.
      await tx.update(adsAudienceUploads).set({ status: "ambiguous", errorCode: "UNAVAILABLE", updatedAt: sql`clock_timestamp()` })
        .where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.id, pending.id)));
      await audit(tx, tenant, user, "audience_upload_outcome", pending.id, { sent: "0" });
    }

    const view = audience.crmSavedViewId ? await audienceView(tx, tenant, audience.crmSavedViewId) : undefined;
    const { members, eligible, excluded } = view ? await computeEligibility(tx, tenant, view, true) : { members: [], eligible: 0, excluded: {} };
    const attemptId = randomUUID();
    const values = { eligible, excluded, status: "pending", attemptId, sent: 0, errorCode: null, updatedAt: sql`clock_timestamp()` };
    const [row] = prior
      ? await tx.update(adsAudienceUploads).set(values).where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.id, prior.id))).returning()
      : await tx.insert(adsAudienceUploads).values({ tenantId: tenant, adAccountId: input.adAccountId, audienceId: input.audienceId,
        idempotencyKey: input.idempotencyKey, requestedBy: user, ...values }).returning();
    await audit(tx, tenant, user, "audience_upload_requested", row.id, { eligible: String(eligible) });
    return { replay: false, row, attemptId, access, audienceRef: audience.externalRef, members, belowMinimum: eligible < access.minimum } as const;
  });
  if (claim.replay) {
    if (!claim.upload) throw unavailableAudience();
    return { upload: claim.upload, replayed: true };
  }

  // The claim and eligibility locks have committed. Recovery recomputes current consent and applies a full replacement
  // with a fresh attempt key, even if this process stopped after the previous replacement was accepted.
  let sent = 0;
  let code: string | null = null;
  try {
    ({ received: sent } = await claim.access.provider.uploadAudienceMembers(claim.access.credential, {
      ...claim.access.query, audienceRef: claim.audienceRef, idempotencyKey: claim.attemptId,
      members: claim.belowMinimum ? [] : claim.members,
    }));
  } catch (error) { code = failureCode(error); }

  const status = code === null ? "sent" : code === "UNAVAILABLE" ? "ambiguous" : "failed";
  await withCrmAudience(db, user, workspace, deps, async (tx, tenant) => {
    const [recorded] = await tx.update(adsAudienceUploads).set({ status, sent, errorCode: code, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(adsAudienceUploads.tenantId, tenant), eq(adsAudienceUploads.id, claim.row.id),
        eq(adsAudienceUploads.attemptId, claim.attemptId), eq(adsAudienceUploads.status, "pending")))
      .returning({ id: adsAudienceUploads.id });
    if (!recorded) throw stale("AUDIENCE_UPLOAD_PENDING");
    await audit(tx, tenant, user, "audience_upload_outcome", recorded.id, { sent: String(sent) });
  });
  if (claim.belowMinimum) throw unavailableAudience();
  return { upload: { status, eligible: claim.row.eligible, sent, excluded: claim.row.excluded }, replayed: false };
}
