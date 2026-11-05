import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, companies, contactCompanyLinks, contacts, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, linkCompany, listContacts, patchContact, recordConsent, unlinkCompany, updateCompanyLink } from "../../src/server/contacts";
import { createCompany, getCompany, listCompanies, patchCompany } from "../../src/server/companies";
import { listCompanyActivity, listContactActivity } from "../../src/server/activity";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string;
let personA: string, personB: string, companyA: string, companyB: string;
const consent = { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", source: "Synthetic form", evidence: "Synthetic proof" } as const;

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "viewer-a", "member-a", "admin-a"].map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "CRM tenant A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "CRM tenant B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "viewer-a@example.test", "viewer");
  await putMember(fixture.db, "owner-a", tenantA, "member-a@example.test", "member");
  await putMember(fixture.db, "owner-a", tenantA, "admin-a@example.test", "admin");
  personA = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ada Lovelace", email: "ada@example.test" })).id;
  personB = (await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic Ada Lovelace", email: "ada@example.test" })).id;
  companyA = (await createCompany(fixture.db, "owner-a", tenantA, { name: "Analytical Engines", domain: "https://www.Engines.example/about" })).id;
  companyB = (await createCompany(fixture.db, "owner-b", tenantB, { name: "Analytical Engines", domain: "engines.example" })).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CRM-01 schema, RLS and grants", () => {
  it("forces RLS on the new tables and exposes nothing without tenant context", async () => {
    const { rows } = await fixture.admin.query("select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('companies','contact_company_links') order by relname");
    expect(rows).toEqual([{ relname: "companies", relrowsecurity: true, relforcerowsecurity: true }, { relname: "contact_company_links", relrowsecurity: true, relforcerowsecurity: true }]);
    expect(await fixture.db.select().from(companies)).toEqual([]);
    expect(await fixture.db.select().from(contactCompanyLinks)).toEqual([]);
  });
  it("normalizes domains and keeps the same domain independent per tenant", async () => {
    expect((await getCompany(fixture.db, "owner-a", tenantA, companyA)).domain).toBe("engines.example");
    expect((await getCompany(fixture.db, "owner-b", tenantB, companyB)).domain).toBe("engines.example");
  });
  it("rejects duplicate tenant domains with the existing record and never merges", async () => {
    await expect(createCompany(fixture.db, "owner-a", tenantA, { name: "Other name", domain: "ENGINES.example." })).rejects.toMatchObject({ status: 409, details: { existingId: companyA } });
    expect((await listCompanies(fixture.db, "owner-a", tenantA)).total).toBe(1);
  });
  it("enforces format, length and provenance constraints in SQL", async () => {
    for (const values of [
      { name: "Bad", domain: "Not A Domain", createdBy: "owner-a" },
      { name: " padded ", domain: null, createdBy: "owner-a" },
      { name: "x".repeat(101), domain: null, createdBy: "owner-a" },
      { name: "Forged creator", domain: null, createdBy: "owner-b" },
    ]) await expect(withTenant(fixture.db, "owner-a", tenantA, "companies:write", (tx) => tx.insert(companies).values({ tenantId: tenantA, ...values }))).rejects.toThrow();
    await expect(fixture.pool.query("delete from companies")).rejects.toThrow(/permission denied/);
    await expect(withTenant(fixture.db, "owner-a", tenantA, "companies:write", (tx) => tx.execute(sql`update companies set created_by = 'owner-b'`))).rejects.toMatchObject({ cause: { code: "42501" } });
  });
  it("blocks cross-tenant references in both directions through FK and RLS", async () => {
    for (const [owner, tenant, contact, company] of [["owner-a", tenantA, personA, companyB], ["owner-b", tenantB, personB, companyA]] as const) {
      await expect(withTenant(fixture.db, owner, tenant, "contacts:write", (tx) => tx.insert(contactCompanyLinks).values({ tenantId: tenant, contactId: contact, companyId: company, createdBy: owner }))).rejects.toThrow();
      const foreignTenant = tenant === tenantA ? tenantB : tenantA;
      await expect(withTenant(fixture.db, owner, tenant, "contacts:write", (tx) => tx.insert(contactCompanyLinks).values({ tenantId: foreignTenant, contactId: contact, companyId: company, createdBy: owner }))).rejects.toThrow();
    }
    // Even the table owner cannot mix tenants: composite FKs bind both sides to one tenant.
    await expect(fixture.admin.query(`select set_config('app.user_id', 'owner-a', true); insert into contact_company_links (tenant_id, contact_id, company_id, created_by) values ('${tenantA}', '${personA}', '${companyB}', 'owner-a')`)).rejects.toThrow(/foreign key/);
    await withTenant(fixture.db, "owner-a", tenantA, "companies:read", async (tx) => {
      expect((await tx.select().from(companies)).map((row) => row.id)).toEqual([companyA]);
      expect(await tx.update(companies).set({ name: "Forbidden" }).where(eq(companies.tenantId, tenantB)).returning()).toEqual([]);
    });
    await withTenant(fixture.db, "owner-b", tenantB, "companies:read", async (tx) => {
      expect((await tx.select().from(companies)).map((row) => row.id)).toEqual([companyB]);
    });
  });
});

describe("CRM services: permissions, isolation and mutations", () => {
  it("denies forged hints, foreign IDs and anonymous callers on every CRM entry point", async () => {
    await expect(listCompanies(fixture.db, "owner-a", tenantB)).rejects.toMatchObject({ status: 403 });
    await expect(getCompany(fixture.db, "owner-a", tenantA, companyB)).rejects.toMatchObject({ status: 404 });
    await expect(getCompany(fixture.db, "owner-b", tenantB, companyA)).rejects.toMatchObject({ status: 404 });
    await expect(patchCompany(fixture.db, "owner-a", tenantA, companyB, { name: "x", version: 1 })).rejects.toMatchObject({ status: 404 });
    await expect(linkCompany(fixture.db, "owner-a", tenantA, personA, { companyId: companyB })).rejects.toMatchObject({ status: 404 });
    await expect(linkCompany(fixture.db, "owner-b", tenantB, personB, { companyId: companyA })).rejects.toMatchObject({ status: 404 });
    await expect(linkCompany(fixture.db, "owner-a", tenantA, personB, { companyId: companyA })).rejects.toMatchObject({ status: 404 });
    await expect(createContact(fixture.db, "owner-a", tenantA, { name: "Foreign link", companyId: companyB })).rejects.toMatchObject({ status: 404 });
    await expect(patchContact(fixture.db, "owner-a", tenantA, personB, { name: "x", version: 1 })).rejects.toMatchObject({ status: 404 });
    expect(await listCompanyActivity(fixture.db, "owner-a", tenantA, companyB)).toEqual([]);
    expect(await listContactActivity(fixture.db, "owner-a", tenantA, personB)).toEqual([]);
    await expect(listCompanyActivity(fixture.db, "owner-a", tenantB, companyB)).rejects.toMatchObject({ status: 403 });
    await expect(listCompanies(fixture.db, "", tenantA)).rejects.toMatchObject({ status: 401 });
    expect((await listContacts(fixture.db, "owner-a", tenantA, { company: companyB })).total).toBe(0);
  });
  it("lets viewers read and denies every viewer write", async () => {
    expect((await listCompanies(fixture.db, "viewer-a", tenantA)).total).toBe(1);
    expect((await getCompany(fixture.db, "viewer-a", tenantA, companyA)).name).toBe("Analytical Engines");
    await expect(createCompany(fixture.db, "viewer-a", tenantA, { name: "Denied" })).rejects.toMatchObject({ status: 403 });
    await expect(patchCompany(fixture.db, "viewer-a", tenantA, companyA, { name: "Denied", version: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(patchContact(fixture.db, "viewer-a", tenantA, personA, { name: "Denied", version: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(linkCompany(fixture.db, "viewer-a", tenantA, personA, { companyId: companyA })).rejects.toMatchObject({ status: 403 });
    await expect(updateCompanyLink(fixture.db, "viewer-a", tenantA, personA, companyA, { title: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(unlinkCompany(fixture.db, "viewer-a", tenantA, personA, companyA)).rejects.toMatchObject({ status: 403 });
  });
  it("links explicitly, keeps exactly one primary and promotes on unlink", async () => {
    const second = (await createCompany(fixture.db, "member-a", tenantA, { name: "Difference Works", description: "Synthetic" })).id;
    await linkCompany(fixture.db, "member-a", tenantA, personA, { companyId: companyA, title: "Analyst" });
    await linkCompany(fixture.db, "member-a", tenantA, personA, { companyId: second });
    let detail = await getContact(fixture.db, "owner-a", tenantA, personA);
    expect(detail.companies.map((row) => [row.companyId, row.isPrimary, row.title])).toEqual([[companyA, true, "Analyst"], [second, false, ""]]);
    await expect(linkCompany(fixture.db, "member-a", tenantA, personA, { companyId: second })).rejects.toMatchObject({ status: 409 });
    await updateCompanyLink(fixture.db, "member-a", tenantA, personA, second, { isPrimary: true, title: "Founder" });
    detail = await getContact(fixture.db, "owner-a", tenantA, personA);
    expect(detail.companies.filter((row) => row.isPrimary).map((row) => row.companyId)).toEqual([second]);
    await expect(fixture.admin.query("update contact_company_links set is_primary = true where tenant_id = $1 and contact_id = $2", [tenantA, personA])).rejects.toThrow(/company_links_one_primary_idx/);
    await unlinkCompany(fixture.db, "member-a", tenantA, personA, second);
    detail = await getContact(fixture.db, "owner-a", tenantA, personA);
    expect(detail.companies.map((row) => [row.companyId, row.isPrimary])).toEqual([[companyA, true]]);
    await expect(unlinkCompany(fixture.db, "member-a", tenantA, personA, second)).rejects.toMatchObject({ status: 404 });
    expect((await getCompany(fixture.db, "owner-a", tenantA, companyA)).people.map((row) => [row.id, row.email])).toEqual([[personA, "ada@example.test"]]);
  });
  it("creates a person directly under a company in one audited transaction", async () => {
    const created = await createContact(fixture.db, "member-a", tenantA, { name: "Synthetic Charles", email: "charles@example.test", companyId: companyA, title: "Engineer" });
    const detail = await getContact(fixture.db, "owner-a", tenantA, created.id);
    expect(detail.companies).toMatchObject([{ companyId: companyA, isPrimary: true, title: "Engineer" }]);
    expect((await listContactActivity(fixture.db, "owner-a", tenantA, created.id)).map((row) => row.action).sort()).toEqual(["contact.company_link", "contact.create"]);
  });
  it("patches only supplied fields under optimistic versions and audits field names, not values", async () => {
    const before = await getContact(fixture.db, "owner-a", tenantA, personA);
    const updated = await patchContact(fixture.db, "member-a", tenantA, personA, { phone: "+44 20 7946 0000", version: before.version });
    expect(updated.version).toBe(before.version + 1);
    const after = await getContact(fixture.db, "owner-a", tenantA, personA);
    expect(after.identifiers.map((row) => [row.kind, row.value]).sort()).toEqual([["email", "ada@example.test"], ["phone", "+442079460000"]]);
    await expect(patchContact(fixture.db, "member-a", tenantA, personA, { name: "Stale", version: before.version })).rejects.toMatchObject({ status: 409 });
    expect(await patchContact(fixture.db, "member-a", tenantA, personA, { phone: "+442079460000", version: updated.version })).toMatchObject({ version: updated.version });
    await patchContact(fixture.db, "member-a", tenantA, personA, { phone: "", version: updated.version });
    expect((await getContact(fixture.db, "owner-a", tenantA, personA)).identifiers.map((row) => row.kind)).toEqual(["email"]);
    await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", async (tx) => {
      const events = await tx.select().from(auditLogs).where(and(eq(auditLogs.action, "contact.update"), eq(auditLogs.targetId, personA)));
      expect(events.map((row) => row.metadata)).toEqual([{ fields: "phone" }, { fields: "phone" }]);
      expect(JSON.stringify(events)).not.toContain("7946");
    });
  });
  it("rolls back a patch whose normalized identifier belongs to someone else", async () => {
    const other = await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Other", email: "other@example.test" });
    const current = await getContact(fixture.db, "owner-a", tenantA, personA);
    await expect(patchContact(fixture.db, "owner-a", tenantA, personA, { name: "Renamed", email: "OTHER@example.test", version: current.version })).rejects.toMatchObject({ status: 409 });
    expect(await getContact(fixture.db, "owner-a", tenantA, personA)).toMatchObject({ name: current.name, version: current.version });
    expect((await getContact(fixture.db, "owner-a", tenantA, other.id)).identifiers).toHaveLength(1);
  });
  it("patches companies with version checks, domain uniqueness and field-only audit", async () => {
    const company = await getCompany(fixture.db, "owner-a", tenantA, companyA);
    const updated = await patchCompany(fixture.db, "member-a", tenantA, companyA, { description: "Synthetic difference engine maker", version: company.version });
    await expect(patchCompany(fixture.db, "member-a", tenantA, companyA, { name: "Stale", version: company.version })).rejects.toMatchObject({ status: 409 });
    const spare = await createCompany(fixture.db, "owner-a", tenantA, { name: "Spare", domain: "spare.example" });
    await expect(patchCompany(fixture.db, "owner-a", tenantA, spare.id, { domain: "engines.example", version: spare.version })).rejects.toMatchObject({ status: 409, details: { existingId: companyA } });
    await expect(Promise.resolve().then(() => patchCompany(fixture.db, "owner-a", tenantA, spare.id, { domain: "not a domain", version: spare.version }))).rejects.toThrow();
    const activity = await listCompanyActivity(fixture.db, "owner-a", tenantA, companyA);
    expect(activity.find((row) => row.action === "company.update")).toMatchObject({ fields: ["description"], actor: { name: "Synthetic member-a", isMember: true } });
    expect(updated.version).toBe(company.version + 1);
  });
  it("suggests same-name duplicates without merging, within the tenant only", async () => {
    const twin = await createContact(fixture.db, "owner-a", tenantA, { name: "  synthetic   ADA lovelace " });
    expect((await getContact(fixture.db, "owner-a", tenantA, twin.id)).possibleDuplicates.map((row) => row.id)).toEqual([personA]);
    expect((await getContact(fixture.db, "owner-b", tenantB, personB)).possibleDuplicates).toEqual([]);
    const twinCompany = await createCompany(fixture.db, "owner-a", tenantA, { name: "analytical engines" });
    expect((await getCompany(fixture.db, "owner-a", tenantA, twinCompany.id)).possibleDuplicates.map((row) => row.id)).toEqual([companyA]);
    expect((await getCompany(fixture.db, "owner-b", tenantB, companyB)).possibleDuplicates).toEqual([]);
    expect((await listContacts(fixture.db, "owner-a", tenantA, { q: "lovelace" })).total).toBe(2);
  });
});

describe("CRM lists: search, filters, sorting and tenant scope", () => {
  it("filters by company link, email presence and effective marketing consent", async () => {
    const all = await listContacts(fixture.db, "owner-a", tenantA);
    const linked = await listContacts(fixture.db, "owner-a", tenantA, { company: "any" });
    const unlinked = await listContacts(fixture.db, "owner-a", tenantA, { company: "none" });
    expect(linked.total + unlinked.total).toBe(all.total);
    expect((await listContacts(fixture.db, "owner-a", tenantA, { company: companyA })).rows.map((row) => row.name).sort()).toEqual(["Synthetic Ada Lovelace", "Synthetic Charles"]);
    expect((await listContacts(fixture.db, "owner-a", tenantA, { company: companyA })).filterCompany).toEqual({ id: companyA, name: "Analytical Engines" });
    const withEmail = await listContacts(fixture.db, "owner-a", tenantA, { email: "with" });
    expect(withEmail.rows.every((row) => row.identifiers.some((item) => item.kind === "email"))).toBe(true);
    expect(withEmail.total + (await listContacts(fixture.db, "owner-a", tenantA, { email: "without" })).total).toBe(all.total);
    await recordConsent(fixture.db, "owner-a", tenantA, personA, { ...consent, status: "granted" });
    expect((await listContacts(fixture.db, "owner-a", tenantA, { marketing: "granted" })).rows.map((row) => row.id)).toEqual([personA]);
    await recordConsent(fixture.db, "owner-a", tenantA, personA, { ...consent, status: "withdrawn" });
    await recordConsent(fixture.db, "owner-a", tenantA, personA, { ...consent, status: "granted", occurredAt: new Date(Date.now() - 86_400_000).toISOString() });
    // A backdated grant never overrides the withdrawal, in the list as on the detail page.
    const withdrawn = await listContacts(fixture.db, "owner-a", tenantA, { marketing: "withdrawn" });
    expect(withdrawn.rows.map((row) => [row.id, row.marketingEmail])).toEqual([[personA, "withdrawn"]]);
    expect((await getContact(fixture.db, "owner-a", tenantA, personA)).effectiveConsents.find((row) => row.channel === "email" && row.purpose === "marketing")?.status).toBe("withdrawn");
    expect((await listContacts(fixture.db, "owner-a", tenantA, { marketing: "none" })).total).toBe(all.total - 1);
  });
  it("searches company names, sorts deterministically and isolates totals", async () => {
    expect((await listContacts(fixture.db, "owner-a", tenantA, { q: "analytical" })).rows.map((row) => row.name).sort()).toEqual(["Synthetic Ada Lovelace", "Synthetic Charles"]);
    expect((await listContacts(fixture.db, "owner-b", tenantB, { q: "analytical" })).total).toBe(0);
    const names = (await listContacts(fixture.db, "owner-a", tenantA, { sort: "-name" })).rows.map((row) => row.normalizedName);
    expect(names).toEqual([...names].sort().reverse());
    const companiesByPeople = await listCompanies(fixture.db, "owner-a", tenantA, { sort: "-people" });
    expect(companiesByPeople.rows[0]).toMatchObject({ id: companyA, peopleCount: 2 });
    expect((await listCompanies(fixture.db, "owner-a", tenantA, { people: "none" })).rows.every((row) => row.peopleCount === 0)).toBe(true);
    expect((await listCompanies(fixture.db, "owner-a", tenantA, { q: "engines.ex" })).rows.map((row) => row.id)).toEqual([companyA]);
    expect((await listCompanies(fixture.db, "owner-b", tenantB)).total).toBe(1);
    expect((await listCompanies(fixture.db, "owner-a", tenantA, { domain: "without" })).rows.every((row) => row.domain === null)).toBe(true);
    await expect(Promise.resolve().then(() => listContacts(fixture.db, "owner-a", tenantA, { sort: "dropped" as never }))).rejects.toThrow();
  });
});

describe("CRM activity and erasure", () => {
  it("builds person and company activity from real audit events", async () => {
    const contactActivity = await listContactActivity(fixture.db, "viewer-a", tenantA, personA);
    expect(contactActivity.map((row) => row.action)).toEqual(expect.arrayContaining(["contact.create", "contact.update", "contact.company_link", "contact.company_unlink", "contact.consent_record"]));
    expect(contactActivity.find((row) => row.action === "contact.consent_record")).toMatchObject({ channel: "email" });
    const companyActivity = await listCompanyActivity(fixture.db, "viewer-a", tenantA, companyA);
    expect(companyActivity.filter((row) => row.action === "contact.company_link").map((row) => row.contact?.name).sort()).toEqual(["Synthetic Ada Lovelace", "Synthetic Charles"]);
    expect(companyActivity.at(-1)).toMatchObject({ action: "company.create", actor: { name: "Synthetic owner-a" } });
  });
  it("erasure removes company links and scrubs link history while preserving the company", async () => {
    await eraseContact(fixture.db, "admin-a", tenantA, personA);
    const company = await getCompany(fixture.db, "owner-a", tenantA, companyA);
    expect(company.people.map((row) => row.name)).toEqual(["Synthetic Charles"]);
    const { rows } = await fixture.admin.query("select count(*)::int as links from contact_company_links where tenant_id = $1 and contact_id = $2", [tenantA, personA]);
    expect(rows[0].links).toBe(0);
    const activity = await listCompanyActivity(fixture.db, "owner-a", tenantA, companyA);
    expect(activity.filter((row) => row.action.startsWith("contact.")).map((row) => row.contact?.name)).toEqual(["Synthetic Charles"]);
    const audit = await fixture.admin.query("select metadata, target_id from audit_logs where tenant_id = $1 and (target_id = $2 or metadata->>'contactId' = $2)", [tenantA, personA]);
    expect(audit.rows).toEqual([]);
    await expect(getContact(fixture.db, "owner-a", tenantA, personA)).rejects.toMatchObject({ status: 404 });
    // Erased tombstones can never gain a company again, even by direct SQL.
    const tombstone = (await fixture.admin.query("select id from contacts where tenant_id = $1 and erased_at is not null limit 1", [tenantA])).rows[0].id;
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(contactCompanyLinks).values({ tenantId: tenantA, contactId: tombstone, companyId: companyA, createdBy: "owner-a" }))).rejects.toThrow();
    expect((await getContact(fixture.db, "owner-b", tenantB, personB)).name).toBe("Synthetic Ada Lovelace");
  });
  it("keeps link identity immutable and provenance bound to the verified user", async () => {
    const [link] = await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", (tx) => tx.select().from(contactCompanyLinks).limit(1));
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.execute(sql`update contact_company_links set company_id = ${companyB} where contact_id = ${link.contactId}`))).rejects.toMatchObject({ cause: { code: "42501" } });
    const fresh = await createCompany(fixture.db, "owner-a", tenantA, { name: "Provenance check" });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(contactCompanyLinks).values({ tenantId: tenantA, contactId: link.contactId, companyId: fresh.id, createdBy: "owner-b" }))).rejects.toMatchObject({ cause: { message: expect.stringMatching(/provenance/) } });
    const [row] = await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", (tx) => tx.select().from(contacts).where(eq(contacts.id, link.contactId)));
    expect(row.erasedAt).toBeNull();
  });
});
