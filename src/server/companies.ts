import { message } from "../i18n/messages";
import { and, asc, count, desc, eq, exists, ilike, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, contactCompanyLinks, contactIdentifiers, contacts } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { CRM_PAGE_SIZE, DUPLICATE_MIN_LENGTH, companyInput, companyPatch, companyQuery, type CompanyInput, type CompanyPatch, type CompanyQuery } from "../lib/crm-input";
import { recordActivity } from "./activity";
import { likePattern, pgCode } from "./contacts";
import { AccessError } from "./permissions";
import { withTenant } from "./tenancy";

const missing = () => new AccessError(404, message("Errors.thisCompanyIsNotAvailableInThisWorkspace"));

/** Domain is the only hard company identity; a matching name is only a suggestion. */
async function domainConflict<T>(db: Database, userId: string, tenantHint: string, domain: string | null | undefined, operation: () => Promise<T>) {
  try { return await operation(); }
  catch (error) {
    if (pgCode(error) !== "23505" || !domain) throw error;
    const existing = await withTenant(db, userId, tenantHint, "companies:read", (tx, tenantId) =>
      tx.select({ id: companies.id }).from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.domain, domain))));
    throw new AccessError(409, message("Errors.aCompanyWithThisDomainAlreadyExists"), existing[0] ? { existingId: existing[0].id } : undefined);
  }
}

export function listCompanies(db: Database, userId: string, workspace: string, query: CompanyQuery = {}) {
  const { q, page, sort, people, domain } = companyQuery.parse(query);
  return withTenant(db, userId, uuidInput.parse(workspace), "companies:read", async (tx, tenantId) => {
    const pattern = likePattern(q);
    const peopleCount = sql<number>`(select count(*)::int from contact_company_links l where l.tenant_id = ${tenantId} and l.company_id = companies.id)`;
    const hasPeople = exists(tx.select({ one: sql`1` }).from(contactCompanyLinks).where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.companyId, companies.id))));
    const where = and(eq(companies.tenantId, tenantId),
      q ? or(ilike(companies.name, pattern), ilike(companies.domain, pattern)) : undefined,
      people === "any" ? hasPeople : people === "none" ? sql`not ${hasPeople}` : undefined,
      domain === "with" ? isNotNull(companies.domain) : domain === "without" ? isNull(companies.domain) : undefined);
    const order = { name: [asc(companies.normalizedName), asc(companies.id)], "-name": [desc(companies.normalizedName), desc(companies.id)],
      "-created": [desc(companies.createdAt), desc(companies.id)], created: [asc(companies.createdAt), asc(companies.id)],
      "-people": [desc(peopleCount), asc(companies.normalizedName), asc(companies.id)] }[sort];
    const [{ total }] = await tx.select({ total: count() }).from(companies).where(where);
    const rows = await tx.select({ id: companies.id, name: companies.name, domain: companies.domain, description: companies.description, createdAt: companies.createdAt, updatedAt: companies.updatedAt, version: companies.version, peopleCount })
      .from(companies).where(where).orderBy(...order).limit(CRM_PAGE_SIZE).offset((page - 1) * CRM_PAGE_SIZE);
    return { rows, total, page, q, sort, filters: { people: people ?? null, domain: domain ?? null } };
  });
}

export function getCompany(db: Database, userId: string, workspace: string, company: string) {
  return withTenant(db, userId, uuidInput.parse(workspace), "companies:read", async (tx, tenantId) => {
    const id = uuidInput.parse(company);
    const [row] = await tx.select().from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id)));
    if (!row) throw missing();
    const people = await tx.select({ id: contacts.id, name: contacts.name, title: contactCompanyLinks.title, isPrimary: contactCompanyLinks.isPrimary, linkedAt: contactCompanyLinks.createdAt })
      .from(contactCompanyLinks).innerJoin(contacts, and(eq(contacts.tenantId, contactCompanyLinks.tenantId), eq(contacts.id, contactCompanyLinks.contactId)))
      .where(and(eq(contactCompanyLinks.tenantId, tenantId), eq(contactCompanyLinks.companyId, id), isNull(contacts.erasedAt)))
      .orderBy(asc(contacts.normalizedName), asc(contacts.id));
    const emails = people.length ? await tx.select({ contactId: contactIdentifiers.contactId, value: contactIdentifiers.value }).from(contactIdentifiers)
      .where(and(eq(contactIdentifiers.tenantId, tenantId), eq(contactIdentifiers.kind, "email"), inArray(contactIdentifiers.contactId, people.map((person) => person.id)))) : [];
    const possibleDuplicates = row.normalizedName.length >= DUPLICATE_MIN_LENGTH ? await tx.select({ id: companies.id, name: companies.name, domain: companies.domain }).from(companies)
      .where(and(eq(companies.tenantId, tenantId), eq(companies.normalizedName, row.normalizedName), ne(companies.id, id))).orderBy(asc(companies.createdAt), asc(companies.id)).limit(5) : [];
    return { ...row, people: people.map((person) => ({ ...person, email: emails.find((item) => item.contactId === person.id)?.value ?? null })), possibleDuplicates };
  });
}

export function createCompany(db: Database, userId: string, workspace: string, data: CompanyInput) {
  const input = companyInput.parse(data), hint = uuidInput.parse(workspace);
  return domainConflict(db, userId, hint, input.domain, () => withTenant(db, userId, hint, "companies:write", async (tx, tenantId) => {
    const [row] = await tx.insert(companies).values({ tenantId, name: input.name, domain: input.domain, description: input.description, createdBy: userId }).returning();
    await recordActivity(tx, { tenantId, actorId: userId, action: "company.create", targetId: row.id });
    return row;
  }));
}

export function patchCompany(db: Database, userId: string, workspace: string, company: string, data: CompanyPatch) {
  const { version, ...input } = companyPatch.parse(data), id = uuidInput.parse(company), hint = uuidInput.parse(workspace);
  return domainConflict(db, userId, hint, input.domain, () => withTenant(db, userId, hint, "companies:write", async (tx, tenantId) => {
    const [current] = await tx.select().from(companies).where(and(eq(companies.tenantId, tenantId), eq(companies.id, id))).for("update");
    if (!current) throw missing();
    if (current.version !== version) throw new AccessError(409, message("Errors.thisRecordChangedReloadAndTryAgain"));
    const changed = (["name", "domain", "description"] as const).filter((field) => input[field] !== undefined && input[field] !== current[field]);
    if (!changed.length) return current;
    const [row] = await tx.update(companies).set({ ...Object.fromEntries(changed.map((field) => [field, input[field]])), updatedAt: new Date(), version: sql`${companies.version} + 1` })
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, id), eq(companies.version, version))).returning();
    await recordActivity(tx, { tenantId, actorId: userId, action: "company.update", targetId: id, metadata: { fields: changed.join(",") } });
    return row;
  }));
}
