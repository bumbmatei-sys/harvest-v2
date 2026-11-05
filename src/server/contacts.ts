import { and, asc, count, desc, eq, exists, getTableColumns, gt, ilike, inArray, isNull, notExists, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../db/client";
import { auditLogs, contactConsents, contactIdentifiers, contacts } from "../db/schema";
import { contactInput, contactQuery, consentInput, uuidInput, type ContactInput, type ConsentInput } from "../lib/contact-input";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

export function listContacts(db: Database, userId: string, workspace: string, query: { q?: string; page?: number } = {}) {
  const { q, page } = contactQuery.parse(query);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const where = and(eq(contacts.tenantId, tenantId), isNull(contacts.erasedAt), q ? or(ilike(contacts.name, pattern), exists(tx.select({ one: sql`1` }).from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, contacts.id), ilike(contactIdentifiers.value, pattern))))) : undefined);
    const [{ total }] = await tx.select({ total: count() }).from(contacts).where(where);
    const rows = await tx.select().from(contacts).where(where).orderBy(asc(contacts.name), asc(contacts.id)).limit(20).offset((page - 1) * 20);
    const identifiers = rows.length ? await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), inArray(contactIdentifiers.contactId, rows.map((row) => row.id)))) : [];
    return { rows: rows.map((row) => ({ ...row, identifiers: identifiers.filter((identifier) => identifier.contactId === row.id) })), total, page, q };
  });
}
export function getContact(db: Database, userId: string, workspace: string, contact: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const id = uuidInput.parse(contact);
    const [row] = await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)));
    if (!row) throw new AccessError(404, "This contact is not available in this workspace.");
    const identifiers = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, id)));
    const grants = alias(contactConsents, "later_grants");
    // Compare in PostgreSQL so strict ordering retains sub-millisecond precision.
    const events = await tx.select({
      event: getTableColumns(contactConsents),
      outstandingWithdrawal: sql<boolean>`${and(eq(contactConsents.status, "withdrawn"), notExists(
        tx.select({ one: sql`1` }).from(grants).where(and(
          eq(grants.tenantId, contactConsents.tenantId), eq(grants.contactId, contactConsents.contactId),
          eq(grants.channel, contactConsents.channel), eq(grants.purpose, contactConsents.purpose),
          eq(grants.status, "granted"), gt(grants.recordedAt, contactConsents.recordedAt), gt(grants.occurredAt, contactConsents.occurredAt),
        )),
      ))}`,
    }).from(contactConsents).where(and(eq(contactConsents.tenantId, tenantId), eq(contactConsents.contactId, id)))
      .orderBy(desc(contactConsents.recordedAt), desc(contactConsents.occurredAt), desc(contactConsents.id));
    const consents = events.map(({ event }) => event);
    // Any unsuperseded unsubscribe wins over grants and unknowns for its scope.
    const effective = new Map<string, typeof events[number]>();
    for (const entry of events) {
      const key = `${entry.event.channel}:${entry.event.purpose}`;
      const previous = effective.get(key);
      if (!previous || (!previous.outstandingWithdrawal && entry.outstandingWithdrawal)) effective.set(key, entry);
    }
    const effectiveConsents = [...effective.values()].map(({ event }) => event);
    return { ...row, identifiers, consents, effectiveConsents };
  });
}
async function insertIdentifiers(tx: Transaction, tenantId: string, contactId: string, input: ReturnType<typeof contactInput.parse>) {
  const values = (["email", "phone", "social"] as const).filter((kind) => input[kind]).map((kind) => ({ tenantId, contactId, kind, value: input[kind], normalizedValue: kind === "social" ? input[kind].replace(/^@/, "").toLowerCase() : input[kind] }));
  if (values.length) await tx.insert(contactIdentifiers).values(values);
}
function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return pgCode(error.cause);
}
async function identityConflict<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) { if (pgCode(error) === "23505") throw new AccessError(409, "An identifier already belongs to a contact in this workspace. Open that contact instead."); throw error; }
}
export function createContact(db: Database, userId: string, workspace: string, data: ContactInput) {
  const input = contactInput.parse(data);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const [row] = await tx.insert(contacts).values({ tenantId, name: input.name, notes: input.notes }).returning();
    await insertIdentifiers(tx, tenantId, row.id, input);
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.create", targetId: row.id });
    return row;
  }));
}
export function updateContact(db: Database, userId: string, workspace: string, contact: string, data: ContactInput) {
  const input = contactInput.parse(data), id = uuidInput.parse(contact);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const [row] = await tx.update(contacts).set({ name: input.name, notes: input.notes, updatedAt: new Date() }).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).returning();
    if (!row) throw new AccessError(404, "This contact is not available in this workspace.");
    await tx.delete(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, id)));
    await insertIdentifiers(tx, tenantId, id, input);
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.update", targetId: id });
    return row;
  }));
}
export function recordConsent(db: Database, userId: string, workspace: string, contact: string, data: ConsentInput) {
  const input = consentInput.parse(data), id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const [parent] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).for("share");
    if (!parent) throw new AccessError(404, "This contact is not available in this workspace.");
    const [consent] = await tx.insert(contactConsents).values({ ...input, tenantId, contactId: id, recordedBy: userId, occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date() }).returning();
    await tx.insert(auditLogs).values({ tenantId, actorId: userId, action: "contact.consent_record", targetId: id, metadata: { consentId: consent.id, channel: input.channel, status: input.status } });
    return consent;
  });
}

// Authentication and membership are checked again inside the fixed SQL erasure path.
// No caller-controlled flag grants permission to mutate the consent ledger.
export function eraseContact(db: Database, userId: string, workspace: string, contact: string) {
  const id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:erase", async (tx, tenantId) => {
    const result = await tx.execute(sql`select public.erase_contact(${tenantId}::uuid, ${id}::uuid) as erased`);
    if (!result.rows[0]?.erased) throw new AccessError(404, "This contact is not available in this workspace.");
    return { erased: true };
  });
}
