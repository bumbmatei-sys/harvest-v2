import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { adsConversionDestinations, adsConversionSends, adsLeads, contactConsents, contactIdentifiers } from "../../db/schema";
import { conversionSendInput, isEeaUkChPhone } from "../../lib/ads/ads";
import { mayContact } from "../consent-gate";
import { audit, failureCode, invalid, loadAccount, parse, providerAccess, stale, unavailable, withAds } from "./access";
import { hashedIdentity } from "./crm-audiences";
import type { ConversionEventBatch } from "./contract";
import { adsFeature, type AdsDeps } from "./registry";

// Conversion events for people who became contacts. Hard-off (ADS_CONVERSIONS_SEND_ENABLED = false). Founder decision 25 Nov: no event for anyone without a valid marketing consent, and people in
// the EEA, the UK or Switzerland who declined (or whose grant is not explicit) are left out. Hashed identifiers only; the record keeps a one-way event digest, so it cannot be traced to a person.
const digestOf = (tenant: string, lead: string, name: string) => createHash("sha256").update(`ads-conversion:${tenant}:${lead}:${name}`).digest("hex");

export async function sendConversionEvents(db: Database, user: string, workspace: string, raw: unknown, deps: AdsDeps): Promise<{ sent: number; status?: string; skipped: Record<string, number> }> {
  if (!adsFeature(deps, "conversionsSend")) throw unavailable();
  const input = parse(conversionSendInput, raw);
  type Claim = { kind: "none"; sent: number; skipped: Record<string, number> } | { kind: "go"; events: ConversionEventBatch["events"]; digests: string[]; skipped: Record<string, number>; destination: typeof adsConversionDestinations.$inferSelect; access: ReturnType<typeof providerAccess> };
  const claim = await withAds(db, user, workspace, deps, async (tx, tenant): Promise<Claim> => {
    const ctx = await loadAccount(tx, tenant, input.adAccountId);
    if (ctx.account.status !== "active") throw invalid("ACCOUNT_NOT_ACTIVE");
    const [destination] = await tx.select().from(adsConversionDestinations).where(and(eq(adsConversionDestinations.tenantId, tenant), eq(adsConversionDestinations.id, input.destinationId), eq(adsConversionDestinations.adAccountId, ctx.account.id)));
    if (!destination) throw unavailable();
    const [prior] = await tx.select({ id: adsConversionSends.id, destinationId: adsConversionSends.destinationId }).from(adsConversionSends).where(and(eq(adsConversionSends.tenantId, tenant), eq(adsConversionSends.idempotencyKey, input.idempotencyKey))).limit(1);
    if (prior && prior.destinationId !== input.destinationId) throw stale("KEY_MISMATCH");
    const leads = await tx.select().from(adsLeads).where(and(eq(adsLeads.tenantId, tenant), eq(adsLeads.adAccountId, ctx.account.id), inArray(adsLeads.id, input.leadIds), isNotNull(adsLeads.contactId)));
    const skipped: Record<string, number> = {}; const events: ConversionEventBatch["events"] = []; const digests: string[] = [];
    const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
    skipped.not_a_contact = input.leadIds.length - leads.length;
    for (const lead of leads) {
      const ids = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenant), eq(contactIdentifiers.contactId, lead.contactId!)));
      const email = ids.find(i => i.kind === "email")?.value ?? null, phone = ids.find(i => i.kind === "phone")?.value ?? null;
      if (!email && !phone) { skip("no_identifier"); continue; }
      const decision = await mayContact(tx, tenant, lead.contactId!, "marketing", email ? "email" : "sms");
      if (!decision.allowed) { skip(decision.reason); continue; }
      if (isEeaUkChPhone(phone) || ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IE","IT","LV","LI","LT","LU","MT","NL","NO","PL","PT","RO","SK","SI","ES","SE","CH","GB","UK"].includes((lead.fields.country ?? "").trim().toUpperCase())) {
        const [row] = await tx.select({ notice: contactConsents.noticeVersion }).from(contactConsents).where(and(eq(contactConsents.tenantId, tenant), eq(contactConsents.id, decision.consentId)));
        if (!row || row.notice === "legacy-unversioned") { skip("region_consent_not_explicit"); continue; }
      }
      const digest = digestOf(tenant, lead.id, input.eventName);
      const [sent] = await tx.select({ id: adsConversionSends.id }).from(adsConversionSends).where(and(eq(adsConversionSends.tenantId, tenant), eq(adsConversionSends.destinationId, destination.id), eq(adsConversionSends.eventDigest, digest), eq(adsConversionSends.status, "sent")));
      if (sent) { skip("already_sent"); continue; }
      events.push({ name: input.eventName, at: lead.submittedAt ?? deps.now(), eventId: digest, userData: hashedIdentity(email, phone) }); digests.push(digest);
    }
    if (!events.length) return { kind: "none", sent: 0, skipped };
    for (const digest of digests) await tx.insert(adsConversionSends).values({ tenantId: tenant, adAccountId: ctx.account.id, destinationId: destination.id, eventName: input.eventName, eventDigest: digest, idempotencyKey: input.idempotencyKey, requestedBy: user })
      .onConflictDoUpdate({ target: [adsConversionSends.tenantId, adsConversionSends.destinationId, adsConversionSends.eventDigest], set: { status: "pending", idempotencyKey: input.idempotencyKey } });
    await audit(tx, tenant, user, "conversion_send_requested", destination.id, { count: String(events.length), event: input.eventName });
    return { kind: "go", events, digests, skipped, destination, access: providerAccess(ctx, deps) };
  });
  if (claim.kind === "none") return { sent: 0, skipped: claim.skipped };
  let accepted = 0, code: string | null = null;
  try { accepted = (await claim.access.provider.sendConversionEvents(claim.access.credential, { ...claim.access.query, destinationRef: claim.destination.externalRef, idempotencyKey: input.idempotencyKey, events: claim.events })).accepted; }
  catch (error) { code = failureCode(error); }
  return withAds(db, user, workspace, deps, async (tx, tenant) => {
    const status = code === null ? "sent" : code === "UNAVAILABLE" ? "ambiguous" : "failed";
    await tx.update(adsConversionSends).set({ status }).where(and(eq(adsConversionSends.tenantId, tenant), eq(adsConversionSends.destinationId, claim.destination.id), inArray(adsConversionSends.eventDigest, claim.digests)));
    await audit(tx, tenant, user, "conversion_send_outcome", claim.destination.id, { outcome: status, accepted: String(accepted), ...(code ? { code } : {}) });
    return { sent: status === "sent" ? accepted : 0, status, skipped: claim.skipped };
  });
}
void sql;
