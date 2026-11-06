import { message } from "../i18n/messages";
import { and, asc, count, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import { companies, contactCompanyLinks, contactIdentifiers, contacts } from "../db/schema";
import { uuidInput } from "../lib/contact-input";
import { CRM_PAGE_SIZE, DUPLICATE_MIN_LENGTH, companyInput, companyPatch, type CompanyInput, type CompanyPatch } from "../lib/crm-input";
import { paramsToState, type RawParams } from "../lib/crm-fields";
import { compileFilter, invalidView, likePattern, loadDefinitions, peopleCountExpr, relatedFilterNames, resolveState, sortOrder } from "./crm-filters";
import { loadRecordValues } from "./crm-fields";
import { recordActivity } from "./activity";
import { pgCode, stale } from "./contacts";
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

/** Companies list on the same validated view-state model as People. */
export function listCompanies(db: Database, userId: string, workspace: string, params: RawParams = {}) {
  const parsed = paramsToState("company", params);
  if (!parsed) throw invalidView();
  return withTenant(db, userId, uuidInput.parse(workspace), "companies:read", async (tx, tenantId) => {
    const definitions = await loadDefinitions(tx, tenantId, "company");
    const state = resolveState("company", parsed.state, definitions), page = parsed.page;
    const peopleCount = peopleCountExpr(tenantId);
    const { where, order } = companiesQuery(tenantId, state, definitions);
    const [{ total }] = await tx.select({ total: count() }).from(companies).where(where);
    const rows = await tx.select({ id: companies.id, name: companies.name, domain: companies.domain, description: companies.description, createdAt: companies.createdAt, updatedAt: companies.updatedAt, version: companies.version, peopleCount })
      .from(companies).where(where).orderBy(...order).limit(CRM_PAGE_SIZE).offset((page - 1) * CRM_PAGE_SIZE);
    const active = definitions.filter((field) => !field.archivedAt);
    const { values, related } = await loadRecordValues(tx, tenantId, "company", rows.map((row) => row.id), active);
    const filterNames = await relatedFilterNames(tx, tenantId, "company", state.filters, definitions);
    return { rows: rows.map((row) => ({ ...row, custom: values.get(row.id) ?? {} })), total, page, state, definitions: active, related: Object.fromEntries([...related, ...filterNames]) };
  });
}

/** The Companies list predicate and order, shared with the CSV export (CRM-06). */
export function companiesQuery(tenantId: string, state: ReturnType<typeof resolveState>, definitions: Awaited<ReturnType<typeof loadDefinitions>>) {
  const pattern = likePattern(state.q);
  const where = and(eq(companies.tenantId, tenantId),
    state.q ? or(ilike(companies.name, pattern), ilike(companies.domain, pattern)) : undefined,
    ...state.filters.map((filter) => compileFilter(tenantId, "company", filter, definitions)));
  const order = sortOrder("company", state.sort, tenantId, definitions, { name: sql.raw("companies.normalized_name"), created: sql.raw("companies.created_at"), people: peopleCountExpr(tenantId) }, sql.raw("companies.id"));
  return { where, order };
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
    if (current.version !== version) throw stale();
    const changed = (["name", "domain", "description"] as const).filter((field) => input[field] !== undefined && input[field] !== current[field]);
    if (!changed.length) return current;
    const [row] = await tx.update(companies).set({ ...Object.fromEntries(changed.map((field) => [field, input[field]])), updatedAt: new Date(), version: sql`${companies.version} + 1` })
      .where(and(eq(companies.tenantId, tenantId), eq(companies.id, id), eq(companies.version, version))).returning();
    await recordActivity(tx, { tenantId, actorId: userId, action: "company.update", targetId: id, metadata: { fields: changed.join(",") } });
    return row;
  }));
}
