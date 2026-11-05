import { message } from "../i18n/messages";
import { and, asc, count, desc, eq, exists, getTableColumns, gt, ilike, inArray, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../db/client";
import { auditLogs, companies, contactCompanyLinks, contactConsents, contactIdentifiers, contacts } from "../db/schema";
import { contactInput, consentInput, uuidInput, type ContactInput, type ConsentInput } from "../lib/contact-input";
import { CRM_PAGE_SIZE, DUPLICATE_MIN_LENGTH, contactPatch, linkInput, linkPatch, newContactInput, peopleQuery, type ContactPatch, type LinkInput, type LinkPatch, type NewContactInput, type PeopleQuery } from "../lib/crm-input";
import { recordActivity } from "./activity";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const kinds = ["email", "phone", "social"] as const;
type Kind = typeof kinds[number];
export const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;
const contactMissing = () => new AccessError(404, message("Errors.thisContactIsNotAvailableInThisWorkspace"));
const companyMissing = () => new AccessError(404, message("Errors.thisCompanyIsNotAvailableInThisWorkspace"));
export const stale = () => new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"), { reason: "stale" });

/**
 * Effective marketing-email state, computed in PostgreSQL with the same rule as the
 * consent ledger on the detail page: an outstanding withdrawal wins unless a grant is
 * strictly later on both clocks; otherwise the latest event decides. The outer
 * reference is written as contacts.id because Drizzle renders single-table select
 * columns unqualified, which would bind to the inner consent row's id instead.
 */
export function marketingEmailState(tenantId: string) {
  return sql<"granted" | "withdrawn" | "none">`(case
    when exists (select 1 from contact_consents w where w.tenant_id = ${tenantId} and w.contact_id = contacts.id
      and w.channel = 'email' and w.purpose = 'marketing' and w.status = 'withdrawn'
      and not exists (select 1 from contact_consents g where g.tenant_id = w.tenant_id and g.contact_id = w.contact_id
        and g.channel = w.channel and g.purpose = w.purpose and g.status = 'granted'
        and g.recorded_at > w.recorded_at and g.occurred_at > w.occurred_at)) then 'withdrawn'
    when (select l.status from contact_consents l where l.tenant_id = ${tenantId} and l.contact_id = contacts.id
      and l.channel = 'email' and l.purpose = 'marketing' order by l.recorded_at desc, l.occurred_at desc, l.id desc limit 1) = 'granted' then 'granted'
    else 'none' end)`;
}

export function listContacts(db: Database, userId: string, workspace: string, query: PeopleQuery = {}) {
  const { q, page, sort, company, email, marketing } = peopleQuery.parse(query);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const pattern = likePattern(q);
    const linkTo = (companyWhere?: SQL) => exists(tx.select({ one: sql`1` }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, contacts.id), companyWhere)));
    const hasEmail = exists(tx.select({ one: sql`1` }).from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, contacts.id), eq(contactIdentifiers.kind, "email"))));
    const state = marketingEmailState(tenantId);
    const where = and(eq(contacts.tenantId, tenantId), isNull(contacts.erasedAt),
      q ? or(ilike(contacts.name, pattern),
        exists(tx.select({ one: sql`1` }).from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, contacts.id), ilike(contactIdentifiers.value, pattern)))),
        exists(tx.select({ one: sql`1` }).from(contactCompanyLinks).innerJoin(companies, and(eq(companies.tenantId, contactCompanyLinks.tenantId), eq(companies.id, contactCompanyLinks.companyId)))
          .where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, contacts.id), ilike(companies.name, pattern))))) : undefined,
      company === "any" ? linkTo() : company === "none" ? sql`not ${linkTo()}` : company ? linkTo(eq(contactCompanyLinks.companyId, company)) : undefined,
      email === "with" ? hasEmail : email === "without" ? sql`not ${hasEmail}` : undefined,
      marketing ? sql`${state} = ${marketing}` : undefined);
    const order = { name: [asc(contacts.normalizedName), asc(contacts.id)], "-name": [desc(contacts.normalizedName), desc(contacts.id)],
      "-created": [desc(contacts.createdAt), desc(contacts.id)], created: [asc(contacts.createdAt), asc(contacts.id)],
      "-updated": [desc(contacts.updatedAt), desc(contacts.id)] }[sort];
    const [{ total }] = await tx.select({ total: count() }).from(contacts).where(where);
    const rows = await tx.select({ ...getTableColumns(contacts), marketingEmail: state }).from(contacts).where(where).orderBy(...order).limit(CRM_PAGE_SIZE).offset((page - 1) * CRM_PAGE_SIZE);
    const ids = rows.map((row) => row.id);
    const identifiers = ids.length ? await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), inArray(contactIdentifiers.contactId, ids))) : [];
    const links = ids.length ? await tx.select({ contactId: contactCompanyLinks.contactId, companyId: companies.id, name: companies.name, isPrimary: contactCompanyLinks.isPrimary, title: contactCompanyLinks.title })
      .from(contactCompanyLinks).innerJoin(companies, and(eq(companies.tenantId, contactCompanyLinks.tenantId), eq(companies.id, contactCompanyLinks.companyId)))
      .where(and(eq(contactCompanyLinks.tenantId, tenantId), inArray(contactCompanyLinks.contactId, ids)))
      .orderBy(desc(contactCompanyLinks.isPrimary), asc(contactCompanyLinks.createdAt), asc(companies.id)) : [];
    const filterCompany = company && company !== "any" && company !== "none"
      ? (await tx.select({ id: companies.id, name: companies.name }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, company))))[0] ?? null : null;
    return {
      rows: rows.map((row) => ({ ...row, identifiers: identifiers.filter((item) => item.contactId === row.id), companies: links.filter((link) => link.contactId === row.id) })),
      total, page, q, sort, filters: { company: company ?? null, email: email ?? null, marketing: marketing ?? null }, filterCompany,
    };
  });
}

async function loadLiveContact(tx: Transaction, tenantId: string, id: string, lock?: "update" | "share") {
  const query = tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt)));
  const [row] = lock ? await query.for(lock) : await query;
  if (!row) throw contactMissing();
  return row;
}

export function getContact(db: Database, userId: string, workspace: string, contact: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:read", async (tx, tenantId) => {
    const id = uuidInput.parse(contact);
    const row = await loadLiveContact(tx, tenantId, id);
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
    const companyLinks = await tx.select({ companyId: companies.id, name: companies.name, domain: companies.domain, title: contactCompanyLinks.title, isPrimary: contactCompanyLinks.isPrimary, linkedAt: contactCompanyLinks.createdAt })
      .from(contactCompanyLinks).innerJoin(companies, and(eq(companies.tenantId, contactCompanyLinks.tenantId), eq(companies.id, contactCompanyLinks.companyId)))
      .where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id)))
      .orderBy(desc(contactCompanyLinks.isPrimary), asc(contactCompanyLinks.createdAt), asc(companies.id));
    // Suggestions only: same display name never implies the same person.
    const possibleDuplicates = row.normalizedName.length >= DUPLICATE_MIN_LENGTH ? await tx.select({ id: contacts.id, name: contacts.name, createdAt: contacts.createdAt }).from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), isNull(contacts.erasedAt), eq(contacts.normalizedName, row.normalizedName), ne(contacts.id, id)))
      .orderBy(asc(contacts.createdAt), asc(contacts.id)).limit(5) : [];
    return { ...row, identifiers, consents, effectiveConsents, companies: companyLinks, possibleDuplicates };
  });
}

function identifierValues(tenantId: string, contactId: string, input: Partial<Record<Kind, string>>) {
  return kinds.filter((kind) => input[kind]).map((kind) => ({ tenantId, contactId, kind, value: input[kind]!, normalizedValue: kind === "social" ? input[kind]!.replace(/^@/, "").toLowerCase() : input[kind]! }));
}
async function insertIdentifiers(tx: Transaction, tenantId: string, contactId: string, input: Partial<Record<Kind, string>>) {
  const values = identifierValues(tenantId, contactId, input);
  if (values.length) await tx.insert(contactIdentifiers).values(values);
}
export function pgCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("code" in error && typeof error.code === "string") return error.code;
  if ("cause" in error) return pgCode(error.cause);
}
function pgConstraint(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  if ("constraint" in error && typeof error.constraint === "string") return error.constraint;
  if ("cause" in error) return pgConstraint(error.cause);
}
async function identityConflict<T>(operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) {
    if (pgCode(error) === "23505" && pgConstraint(error) === "contact_company_links_tenant_id_contact_id_company_id_pk") throw new AccessError(409, message("Errors.thisPersonIsAlreadyLinkedToThatCompany"));
    if (pgCode(error) === "23505") throw new AccessError(409, message("Errors.anIdentifierAlreadyBelongsToAContactIn"));
    throw error;
  }
}
async function requireCompany(tx: Transaction, tenantId: string, companyId: string) {
  const [company] = await tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, companyId))).for("share");
  if (!company) throw companyMissing();
}

export function createContact(db: Database, userId: string, workspace: string, data: ContactInput | NewContactInput) {
  const { companyId, title, ...rest } = newContactInput.parse(data);
  const input = contactInput.parse(rest);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    if (companyId) await requireCompany(tx, tenantId, companyId);
    const [row] = await tx.insert(contacts).values({ tenantId, name: input.name, notes: input.notes }).returning();
    await insertIdentifiers(tx, tenantId, row.id, input);
    await recordActivity(tx, { tenantId, actorId: userId, action: "contact.create", targetId: row.id });
    if (companyId) {
      await tx.insert(contactCompanyLinks).values({ tenantId, contactId: row.id, companyId, title, isPrimary: true, createdBy: userId });
      await recordActivity(tx, { tenantId, actorId: userId, action: "contact.company_link", targetId: row.id, metadata: { companyId } });
    }
    return row;
  }));
}
/** Full replacement used by the original contact form contract. */
export function updateContact(db: Database, userId: string, workspace: string, contact: string, data: ContactInput) {
  const input = contactInput.parse(data), id = uuidInput.parse(contact);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const [row] = await tx.update(contacts).set({ name: input.name, notes: input.notes, updatedAt: new Date(), version: sql`${contacts.version} + 1` }).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).returning();
    if (!row) throw contactMissing();
    await tx.delete(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, id)));
    await insertIdentifiers(tx, tenantId, id, input);
    await recordActivity(tx, { tenantId, actorId: userId, action: "contact.update", targetId: id });
    return row;
  }));
}
/**
 * Inline edits: only supplied fields change, guarded by the version the editor saw.
 * An empty identifier removes it. The audit records changed field names, never values.
 */
export function patchContact(db: Database, userId: string, workspace: string, contact: string, data: ContactPatch) {
  const { version, ...input } = contactPatch.parse(data), id = uuidInput.parse(contact);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const current = await loadLiveContact(tx, tenantId, id, "update");
    if (current.version !== version) throw stale();
    const existing = await tx.select().from(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, id)));
    const changed: string[] = [];
    if (input.name !== undefined && input.name !== current.name) changed.push("name");
    if (input.notes !== undefined && input.notes !== current.notes) changed.push("notes");
    const kindsChanged = kinds.filter((kind) => input[kind] !== undefined && input[kind] !== (existing.find((row) => row.kind === kind)?.value ?? ""));
    changed.push(...kindsChanged);
    if (!changed.length) return current;
    if (kindsChanged.length) {
      await tx.delete(contactIdentifiers).where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.contactId, id), inArray(contactIdentifiers.kind, kindsChanged)));
      await insertIdentifiers(tx, tenantId, id, Object.fromEntries(kindsChanged.map((kind) => [kind, input[kind]])));
    }
    const [row] = await tx.update(contacts).set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}), updatedAt: new Date(), version: sql`${contacts.version} + 1` })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), eq(contacts.version, version))).returning();
    if (!row) throw stale();
    await recordActivity(tx, { tenantId, actorId: userId, action: "contact.update", targetId: id, metadata: { fields: changed.join(",") } });
    return row;
  }));
}

export function linkCompany(db: Database, userId: string, workspace: string, contact: string, data: LinkInput) {
  const input = linkInput.parse(data), id = uuidInput.parse(contact);
  return identityConflict(() => withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    await loadLiveContact(tx, tenantId, id, "update");
    await requireCompany(tx, tenantId, input.companyId);
    const links = await tx.select({ companyId: contactCompanyLinks.companyId }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id)));
    if (links.some((link) => link.companyId === input.companyId)) throw new AccessError(409, message("Errors.thisPersonIsAlreadyLinkedToThatCompany"));
    // The first company becomes primary, matching a single-company CRM by default.
    const isPrimary = input.isPrimary || links.length === 0;
    if (isPrimary) await tx.update(contactCompanyLinks).set({ isPrimary: false }).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.isPrimary, true)));
    const [row] = await tx.insert(contactCompanyLinks).values({ tenantId, contactId: id, companyId: input.companyId, title: input.title, isPrimary, createdBy: userId }).returning();
    await recordActivity(tx, { tenantId, actorId: userId, action: "contact.company_link", targetId: id, metadata: { companyId: input.companyId } });
    return row;
  }));
}
export function updateCompanyLink(db: Database, userId: string, workspace: string, contact: string, company: string, data: LinkPatch) {
  const input = linkPatch.parse(data), id = uuidInput.parse(contact), companyId = uuidInput.parse(company);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    await loadLiveContact(tx, tenantId, id, "update");
    const match = and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.companyId, companyId));
    const [current] = await tx.select().from(contactCompanyLinks).where(match);
    if (!current) throw new AccessError(404, message("Errors.thisCompanyLinkIsNotAvailable"));
    if (input.isPrimary && !current.isPrimary) await tx.update(contactCompanyLinks).set({ isPrimary: false }).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.isPrimary, true)));
    const [row] = await tx.update(contactCompanyLinks).set({ ...(input.title !== undefined ? { title: input.title } : {}), ...(input.isPrimary ? { isPrimary: true } : {}) }).where(match).returning();
    const fields = [input.title !== undefined && input.title !== current.title ? "title" : "", input.isPrimary && !current.isPrimary ? "primary" : ""].filter(Boolean);
    if (fields.length) await recordActivity(tx, { tenantId, actorId: userId, action: "contact.company_link_update", targetId: id, metadata: { companyId, fields: fields.join(",") } });
    return row;
  });
}
export function unlinkCompany(db: Database, userId: string, workspace: string, contact: string, company: string) {
  const id = uuidInput.parse(contact), companyId = uuidInput.parse(company);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    await loadLiveContact(tx, tenantId, id, "update");
    const [removed] = await tx.delete(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.companyId, companyId))).returning();
    if (!removed) throw new AccessError(404, message("Errors.thisCompanyLinkIsNotAvailable"));
    if (removed.isPrimary) {
      const [next] = await tx.select({ companyId: contactCompanyLinks.companyId }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id)))
        .orderBy(asc(contactCompanyLinks.createdAt), asc(contactCompanyLinks.companyId)).limit(1);
      if (next) await tx.update(contactCompanyLinks).set({ isPrimary: true }).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.contactId, id), eq(contactCompanyLinks.companyId, next.companyId)));
    }
    await recordActivity(tx, { tenantId, actorId: userId, action: "contact.company_unlink", targetId: id, metadata: { companyId } });
    return { unlinked: true };
  });
}

export function recordConsent(db: Database, userId: string, workspace: string, contact: string, data: ConsentInput) {
  const input = consentInput.parse(data), id = uuidInput.parse(contact);
  return withTenant(db, userId, uuidInput.parse(workspace), "contacts:write", async (tx, tenantId) => {
    const [parent] = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.erasedAt))).for("share");
    if (!parent) throw contactMissing();
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
    if (!result.rows[0]?.erased) throw contactMissing();
    return { erased: true };
  });
}
