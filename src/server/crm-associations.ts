import { message } from "../i18n/messages";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database, Transaction } from "../db/client";
import { associationKinds, associationPurposes, associationSources, auditLogs, companies, contactIdentifiers, contacts, crmAssociations } from "../db/schema";
import { phoneField, socialField, uuidInput } from "../lib/contact-input";
import { normalizeDomain } from "../lib/crm-input";
import { appendOutboxEvent } from "./jobs/outbox";
import { pgCode } from "./contacts";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export type AssociationPurpose = typeof associationPurposes[number];
const storedText = z.string().refine((value) => !value.includes("\u0000") && value.isWellFormed());
export const associationInput = z.object({
  source: z.enum(associationSources), kind: z.enum(associationKinds), purpose: z.enum(associationPurposes),
  // Either the CRM person, or identifiers to find them by (tenant-unique, never by name).
  contactId: z.uuid().optional(),
  identifiers: z.object({
    email: z.email().max(254).transform((value) => value.toLowerCase()).optional(),
    phone: phoneField.optional(), social: socialField.optional(),
  }).strict().optional(),
  companyId: z.uuid().optional(), companyDomain: z.string().max(300).optional(),
  externalId: storedText.pipe(z.string().trim().min(1).max(200)).optional(),
  occurredAt: z.iso.datetime({ offset: true }).refine((value) => Date.parse(value) <= Date.now() + 5 * 60_000).optional(),
  summary: storedText.pipe(z.string().trim().max(1000)).default(""),
  payload: z.record(z.string(), z.unknown()).default({}).refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 16_384),
}).strict().refine((value) => value.contactId || Object.values(value.identifiers ?? {}).some(Boolean), { message: "contact_required" });
export type AssociationInput = z.input<typeof associationInput>;
export type AssociationResult =
  | { stored: true; duplicate: boolean; id: string; contactId: string }
  | { stored: false; reason: "no_match" | "consent_missing" | "consent_withdrawn"; contactId: string | null };

/**
 * Effective consent for one purpose, from the append-only ledger: any outstanding withdrawal
 * (no later grant on both clocks for the same channel) wins; otherwise the latest grant allows.
 */
export async function purposeConsent(tx: Transaction, tenantId: string, contactId: string, purpose: AssociationPurpose) {
  const rows = await tx.execute<{ id: string; status: string; occurred_at: string; recorded_at: string; source: string | null; outstanding: boolean }>(sql`
    select c.id, c.status, c.occurred_at, c.recorded_at, c.source,
      (c.status = 'withdrawn' and not exists (select 1 from contact_consents g where g.tenant_id = c.tenant_id and g.contact_id = c.contact_id
        and g.channel = c.channel and g.purpose = c.purpose and g.status = 'granted' and g.recorded_at > c.recorded_at and g.occurred_at > c.occurred_at)) as outstanding
    from contact_consents c
    where c.tenant_id = ${tenantId}::uuid and c.contact_id = ${contactId}::uuid and c.purpose = ${purpose} and c.redacted_at is null and c.status in ('granted', 'withdrawn')
    order by c.recorded_at desc, c.occurred_at desc, c.id desc`);
  const withdrawal = rows.rows.find((row) => row.outstanding);
  if (withdrawal) return { allowed: false as const, reason: "consent_withdrawn" as const, event: withdrawal };
  const grant = rows.rows.find((row) => row.status === "granted");
  return grant ? { allowed: true as const, consentId: grant.id, event: grant } : { allowed: false as const, reason: "consent_missing" as const, event: null };
}

/** People that a set of identifiers belongs to (tenant-unique normalized values only). */
async function matchContacts(tx: Transaction, tenantId: string, identifiers: { email?: string; phone?: string; social?: string }) {
  const pairs = (["email", "phone", "social"] as const).filter((kind) => identifiers[kind])
    .map((kind) => ({ kind, value: kind === "social" ? identifiers[kind]!.replace(/^@/, "").toLowerCase() : identifiers[kind]! }));
  if (!pairs.length) return [];
  const rows = await tx.select({ contactId: contactIdentifiers.contactId }).from(contactIdentifiers)
    .innerJoin(contacts, and(eq(contacts.tenantId, contactIdentifiers.tenantId), eq(contacts.id, contactIdentifiers.contactId), isNull(contacts.erasedAt)))
    .where(and(eq(contactIdentifiers.tenantId, tenantId), or(...pairs.map((pair) => and(eq(contactIdentifiers.kind, pair.kind), eq(contactIdentifiers.normalizedValue, pair.value))))));
  return [...new Set(rows.map((row) => row.contactId))];
}

/**
 * Links one Zernio, form or touchpoint event to a CRM person (and optionally a company). It is
 * stored only while the person's consent for its purpose allows it; otherwise nothing is kept
 * and the caller learns why. Redelivery with the same external id is idempotent.
 */
export function recordAssociation(db: Database, userId: string, workspace: string, data: AssociationInput): Promise<AssociationResult> {
  const parsed = associationInput.safeParse(data);
  if (!parsed.success) throw new AccessError(400, message("Errors.checkTheActivityDetails"));
  const input = parsed.data;
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    let contactId: string | null = null;
    if (input.contactId) {
      const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, input.contactId), isNull(contacts.erasedAt)));
      if (!row) throw new AccessError(404, message("Errors.thisContactIsNotAvailableInThisWorkspace"));
      contactId = row.id;
    } else {
      const matched = await matchContacts(tx, tenantId, input.identifiers ?? {});
      if (matched.length > 1) throw new AccessError(409, message("Errors.theseDetailsBelongToDifferentPeople"), { reason: "ambiguous" });
      if (!matched.length) return { stored: false, reason: "no_match", contactId: null };
      contactId = matched[0];
    }
    let companyId: string | null = null;
    if (input.companyId) {
      const [row] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, input.companyId)));
      if (!row) throw new AccessError(404, message("Errors.thisCompanyIsNotAvailableInThisWorkspace"));
      companyId = row.id;
    } else if (input.companyDomain) {
      const domain = normalizeDomain(input.companyDomain);
      if (domain) companyId = (await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.domain, domain))))[0]?.id ?? null;
    }
    if (input.externalId) {
      const [existing] = await tx.select({ id: crmAssociations.id, contactId: crmAssociations.contactId }).from(crmAssociations)
        .where(and(eq(crmAssociations.tenantId, tenantId), eq(crmAssociations.source, input.source), eq(crmAssociations.externalId, input.externalId)));
      if (existing) return { stored: true, duplicate: true, id: existing.id, contactId: existing.contactId };
    }
    const consent = await purposeConsent(tx, tenantId, contactId, input.purpose);
    // No consent for this purpose: nothing about the event is kept, not even in the ledger.
    if (!consent.allowed) return { stored: false, reason: consent.reason, contactId };
    let row: typeof crmAssociations.$inferSelect;
    try {
      [row] = await tx.insert(crmAssociations).values({
        tenantId, contactId, companyId, source: input.source, kind: input.kind, purpose: input.purpose, consentId: consent.consentId,
        externalId: input.externalId ?? null, occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(), summary: input.summary, payload: input.payload, createdBy: userId,
      }).returning();
    } catch (error) {
      if (pgCode(error) === "23505") throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });
      throw error;
    }
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "association.record", targetId: row.id,
      metadata: { contactId, ...(companyId ? { companyId } : {}), source: row.source, kind: row.kind, purpose: row.purpose } });
    // Ids and categories only: the summary and raw payload never leave the table.
    await appendOutboxEvent(tx, tenantId, { kind: "crm.association.recorded", idempotencyKey: `crm:association:${row.id}:recorded`, payload: {
      associationId: row.id, tenantId, actorId: userId, contactId, companyId, source: row.source, kind: row.kind, purpose: row.purpose,
      occurredAt: row.occurredAt.toISOString(), summary: { redacted: true, length: row.summary.length }, payload: { redacted: true },
    } });
    return { stored: true, duplicate: false, id: row.id, contactId };
  });
}

/** Per-purpose consent summary for the record page's "Contact permissions" card. */
export function associationPermissions(db: Database, userId: string, workspace: string, contact: string) {
  const id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const [row] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)));
    if (!row) throw new AccessError(404, message("Errors.thisContactIsNotAvailableInThisWorkspace"));
    const result = [];
    for (const purpose of associationPurposes) {
      const consent = await purposeConsent(tx, tenantId, id, purpose);
      result.push({ purpose, status: consent.allowed ? "granted" as const : consent.reason === "consent_withdrawn" ? "withdrawn" as const : "none" as const,
        at: consent.event ? new Date(consent.event.occurred_at).toISOString() : null, source: consent.event?.source ?? null });
    }
    const [latest] = await tx.select({ count: sql<number>`count(*)::int` }).from(crmAssociations).where(and(eq(crmAssociations.tenantId, tenantId), eq(crmAssociations.contactId, id)));
    return { purposes: result, associations: latest?.count ?? 0 };
  });
}
