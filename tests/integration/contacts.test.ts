import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { auditLogs, contactConsents, contactIdentifiers, contacts, users } from "../../src/db/schema";
import { createWorkspace, getWorkspace, putMember, updateWorkspaceTheme } from "../../src/server/workspaces";
import { createContact, getContact, listContacts, recordConsent, updateContact } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, contactA: string, contactB: string;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "reader", "writer"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Synthetic contacts A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Synthetic contacts B")).tenantId;
  await putMember(fixture.db, "owner-a", tenantA, "reader@example.test", "viewer");
  await putMember(fixture.db, "owner-a", tenantA, "writer@example.test", "member");
  contactA = (await createContact(fixture.db, "owner-a", tenantA, { name: "Synthetic Ada", email: "ada@example.test", phone: "+49123456789", social: "@Ada" })).id;
  contactB = (await createContact(fixture.db, "owner-b", tenantB, { name: "Synthetic Ada B", email: "ada@example.test" })).id;
});
afterAll(async () => { await fixture?.close(); });
describe("contact persistence, evidence and tenant isolation", () => {
  it("forces RLS and exposes no contact data without context", async () => {
    const { rows } = await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname in ('contacts','contact_identifiers','contact_consents')");
    expect(rows).toHaveLength(3); expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    for (const table of [contacts, contactIdentifiers, contactConsents]) expect(await fixture.db.select().from(table)).toEqual([]);
  });
  it("persists a unified contact and same identifier independently across tenants", async () => {
    const a = await getContact(fixture.db, "owner-a", tenantA, contactA);
    expect(a.identifiers.map((row) => row.kind).sort()).toEqual(["email", "phone", "social"]);
    expect(a.consents).toEqual([]);
    expect((await listContacts(fixture.db, "owner-a", tenantA)).total).toBe(1);
    expect((await getContact(fixture.db, "owner-b", tenantB, contactB)).name).toBe("Synthetic Ada B");
  });
  it("rejects normalized duplicates atomically without merging or creating audit rows", async () => {
    await expect(createContact(fixture.db, "owner-a", tenantA, { name: "Duplicate", email: "ADA@example.test" })).rejects.toMatchObject({ status: 409 });
    await expect(createContact(fixture.db, "owner-a", tenantA, { name: "Duplicate", phone: "+49 123 456789" })).rejects.toMatchObject({ status: 409 });
    await expect(createContact(fixture.db, "owner-a", tenantA, { name: "Duplicate", social: "ada" })).rejects.toMatchObject({ status: 409 });
    expect((await listContacts(fixture.db, "owner-a", tenantA)).total).toBe(1);
    await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", async (tx) => expect((await tx.select().from(auditLogs).where(eq(auditLogs.action, "contact.create"))).length).toBe(1));
  });
  it("denies forged workspace hints and foreign detail/update/consent IDs", async () => {
    await expect(listContacts(fixture.db, "owner-a", tenantB)).rejects.toMatchObject({ status: 403 });
    await expect(getContact(fixture.db, "owner-a", tenantA, contactB)).rejects.toMatchObject({ status: 404 });
    await expect(updateContact(fixture.db, "owner-a", tenantA, contactB, { name: "Forbidden" })).rejects.toMatchObject({ status: 404 });
    await expect(recordConsent(fixture.db, "owner-a", tenantA, contactB, { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" })).rejects.toMatchObject({ status: 404 });
    await expect(listContacts(fixture.db, "", tenantA)).rejects.toMatchObject({ status: 401 });
  });
  it("filters unqualified reads and cross-tenant updates and rejects foreign inserts", async () => {
    await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", async (tx) => {
      expect((await tx.select().from(contacts)).map((row) => row.id)).toEqual([contactA]);
      expect(await tx.update(contacts).set({ name: "Forbidden" }).where(eq(contacts.tenantId, tenantB)).returning()).toEqual([]);
      expect((await tx.select().from(contactIdentifiers)).every((row) => row.tenantId === tenantA)).toBe(true);
    });
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(contacts).values({ tenantId: tenantB, name: "Forbidden" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(contactIdentifiers).values({ tenantId: tenantA, contactId: contactB, kind: "email", value: "bad@example.test", normalizedValue: "bad@example.test" }))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "contacts:write", (tx) => tx.insert(contactConsents).values({ tenantId: tenantA, contactId: contactB, recordedBy: "owner-a", purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" }))).rejects.toThrow();
  });
  it("allows viewers to read, members to edit, and rejects viewer writes", async () => {
    expect((await listContacts(fixture.db, "reader", tenantA)).total).toBe(1);
    await expect(createContact(fixture.db, "reader", tenantA, { name: "Denied" })).rejects.toMatchObject({ status: 403 });
    await expect(updateContact(fixture.db, "reader", tenantA, contactA, { name: "Denied" })).rejects.toMatchObject({ status: 403 });
    await expect(recordConsent(fixture.db, "reader", tenantA, contactA, { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" })).rejects.toMatchObject({ status: 403 });
    await updateContact(fixture.db, "writer", tenantA, contactA, { name: "Synthetic Ada", notes: "Updated", email: "ada@example.test", phone: "+49123456789", social: "@Ada" });
    expect((await getContact(fixture.db, "reader", tenantA, contactA)).notes).toBe("Updated");
  });
  it("records append-only consent evidence and audit without implying default consent", async () => {
    await recordConsent(fixture.db, "writer", tenantA, contactA, { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Synthetic signed form", evidence: "Synthetic evidence reference A" });
    await recordConsent(fixture.db, "writer", tenantA, contactA, { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "withdrawn", source: "Synthetic request", evidence: "Synthetic evidence reference B" });
    const detail = await getContact(fixture.db, "reader", tenantA, contactA);
    expect(detail.consents.map((row) => row.status)).toEqual(["withdrawn", "granted"]);
    await expect(fixture.pool.query("update contact_consents set status = 'granted'")).rejects.toThrow();
    await expect(fixture.admin.query("delete from contact_consents")).rejects.toThrow("append-only");
    // CASCADE reaches the append-only trigger past CRM-07's foreign key (as jobs.test.ts does); nothing is truncated.
    await expect(fixture.admin.query("truncate contact_consents cascade")).rejects.toThrow("append-only");
    await withTenant(fixture.db, "owner-a", tenantA, "contacts:read", async (tx) => {
      const events = await tx.select().from(auditLogs).where(eq(auditLogs.action, "contact.consent_record"));
      expect(events).toHaveLength(2); expect(events.every((row) => !JSON.stringify(row.metadata).includes("evidence"))).toBe(true);
    });
  });
  it("rejects future occurrence in SQL and lets a later-recorded backdated withdrawal win", async () => {
    const workspace = (await createWorkspace(fixture.db, "owner-a", "Consent chronology")).tenantId;
    const contact = await createContact(fixture.db, "owner-a", workspace, { name: "Consent chronology" });
    const proof = { purpose: "marketing", noticeVersion: "notice-v1", channel: "email", status: "granted", source: "Test", evidence: "Test" } as const;
    await expect(withTenant(fixture.db, "owner-a", workspace, "contacts:write", (tx) => tx.execute(sql`
      insert into contact_consents (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence,occurred_at)
      values (${workspace},${contact.id},'owner-a','marketing','notice-v1','email','granted','reference','reference',now()+interval '5 minutes 0.001 seconds')`
    ))).rejects.toMatchObject({ cause: { code: "23514", constraint: "consent_occurrence_bound" } });
    await recordConsent(fixture.db, "owner-a", workspace, contact.id, { ...proof, occurredAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    await recordConsent(fixture.db, "owner-a", workspace, contact.id, { ...proof, status: "withdrawn", occurredAt: "2026-10-01T12:00:00Z" });
    const detail = await getContact(fixture.db, "owner-a", workspace, contact.id);
    expect(detail.consents.map((event) => event.status)).toEqual(["withdrawn", "granted"]);
    expect(detail.effectiveConsents).toEqual([detail.consents[0]]);
    // Equal recording timestamps use occurrence as the next ordering key.
    await withTenant(fixture.db, "owner-a", workspace, "contacts:write", async (tx) => {
      await tx.insert(contactConsents).values([
        { ...proof, tenantId: workspace, contactId: contact.id, recordedBy: "owner-a", channel: "sms", occurredAt: new Date("2026-10-01T10:00:00Z") },
        { ...proof, tenantId: workspace, contactId: contact.id, recordedBy: "owner-a", channel: "sms", status: "withdrawn", occurredAt: new Date("2026-10-01T11:00:00Z") },
      ]);
    });
    expect((await getContact(fixture.db, "owner-a", workspace, contact.id)).effectiveConsents.find((event) => event.channel === "sms")?.status).toBe("withdrawn");
  });
  it("searches tenant-qualified identifiers and escapes wildcard text", async () => {
    expect((await listContacts(fixture.db, "reader", tenantA, { q: "ada@example" })).total).toBe(1);
    expect((await listContacts(fixture.db, "reader", tenantA, { q: "%" })).total).toBe(0);
    expect((await listContacts(fixture.db, "reader", tenantA, { q: "Synthetic Ada B" })).total).toBe(0);
    expect((await listContacts(fixture.db, "reader", tenantA, { page: 2 })).rows).toEqual([]);
    expect(() => listContacts(fixture.db, "reader", tenantA, { page: -1 })).toThrow();
  });
  it.each(["commit", "rollback"])("clears all contact visibility on the same pooled backend after %s", async (ending) => {
    const { rows: [{ pid }] } = await fixture.pool.query("select pg_backend_pid() as pid");
    const operation = withTenant(fixture.db, "owner-a", tenantA, "contacts:read", async (tx) => {
      expect((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0]).toMatchObject({ pid });
      expect(await tx.select().from(contactConsents)).toHaveLength(2);
      if (ending === "rollback") throw new Error("intentional rollback");
    });
    if (ending === "rollback") await expect(operation).rejects.toThrow(); else await operation;
    const { rows: [reset] } = await fixture.pool.query("select pg_backend_pid() as pid, nullif(current_setting('app.tenant_id', true), '') as tenant, nullif(current_setting('app.user_id', true), '') as actor");
    expect(reset).toEqual({ pid, tenant: null, actor: null });
    for (const table of [contacts, contactIdentifiers, contactConsents]) expect(await fixture.db.select().from(table)).toEqual([]);
  });
  it("paginates with a stable tenant-qualified order and no overlapping rows", async () => {
    const paging = (await createWorkspace(fixture.db, "owner-b", "Synthetic pagination seed")).tenantId;
    await Promise.all(Array.from({ length: 21 }, (_, index) => createContact(fixture.db, "owner-b", paging, { name: `Synthetic page ${String(index).padStart(2, "0")}` })));
    const first = await listContacts(fixture.db, "owner-b", paging);
    const second = await listContacts(fixture.db, "owner-b", paging, { page: 2 });
    expect(first.total).toBe(21); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.id)).size).toBe(21);
    expect(first.rows[0].name).toBe("Synthetic page 00"); expect(second.rows[0].name).toBe("Synthetic page 20");
  });
  it("gates, persists and audits workspace theme without affecting other tenants", async () => {
    await expect(updateWorkspaceTheme(fixture.db, "writer", tenantA, { brandTheme: "studio" })).rejects.toMatchObject({ status: 403 });
    await expect(updateWorkspaceTheme(fixture.db, "owner-a", tenantB, { brandTheme: "studio" })).rejects.toMatchObject({ status: 403 });
    await updateWorkspaceTheme(fixture.db, "owner-a", tenantA, { brandTheme: "studio" });
    expect((await getWorkspace(fixture.db, "reader", tenantA)).brandTheme).toBe("studio");
    expect((await getWorkspace(fixture.db, "owner-b", tenantB)).brandTheme).toBe("harvest");
  });
  it("rolls back contact and identifier updates when audit fails", async () => {
    await fixture.admin.query("create function test_contact_audit_failure() returns trigger language plpgsql as $$ begin raise exception 'test audit failure'; end $$");
    await fixture.admin.query("create trigger test_contact_audit_failure before insert on audit_logs for each row execute function test_contact_audit_failure()");
    try {
      await expect(createContact(fixture.db, "writer", tenantA, { name: "Must roll back", email: "rollback@example.test" })).rejects.toThrow();
      await expect(updateContact(fixture.db, "writer", tenantA, contactA, { name: "Must roll back", email: "changed@example.test" })).rejects.toThrow();
      await expect(recordConsent(fixture.db, "writer", tenantA, contactA, { purpose: "marketing", noticeVersion: "notice-v1", channel: "sms", status: "granted", source: "Test", evidence: "Test" })).rejects.toThrow();
    } finally { await fixture.admin.query("drop trigger test_contact_audit_failure on audit_logs"); }
    const row = await getContact(fixture.db, "reader", tenantA, contactA);
    expect(row.name).toBe("Synthetic Ada"); expect(row.identifiers.some((identifier) => identifier.value === "ada@example.test")).toBe(true);
    expect(row.consents).toHaveLength(2); expect((await listContacts(fixture.db, "reader", tenantA)).total).toBe(1);
  });
});
