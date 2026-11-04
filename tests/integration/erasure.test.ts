import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createContact, eraseContact, getContact, listContacts, recordConsent, updateContact } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>, tenantA: string, tenantB: string;
let restrictedRoleCreated = false;
const proof = { channel: "email", status: "granted", purpose: "marketing", noticeVersion: "notice-v1", source: "Private Person private@example.test", evidence: "+49123456789 @private private note", occurredAt: "2026-10-01T12:30:00Z" } as const;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["eraser-a", "eraser-b", "member", "viewer"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "eraser-a", "Erasure A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "eraser-b", "Erasure B")).tenantId;
  await putMember(fixture.db, "eraser-a", tenantA, "member@example.test", "member");
  await putMember(fixture.db, "eraser-a", tenantA, "viewer@example.test", "viewer");
});
afterAll(async () => {
  if (restrictedRoleCreated) {
    await fixture.admin.query("do $$ begin execute format('alter function public.erase_contact(uuid,uuid) owner to %I', current_user); end $$");
    for (const table of ["contacts", "contact_consents", "contact_identifiers", "workspace_members", "audit_logs"]) {
      await fixture.admin.query(`drop policy if exists test_restricted_erasure on ${table}`);
    }
    await fixture.admin.query("drop owned by harvest_test_eraser");
    await fixture.admin.query("drop role harvest_test_eraser");
  }
  await fixture?.close();
});

describe("controlled contact erasure", () => {
  it("captures provenance and separate occurrence/recording times", async () => {
    const contact = await createContact(fixture.db, "eraser-a", tenantA, { name: "Provenance" });
    const row = await recordConsent(fixture.db, "member", tenantA, contact.id, proof);
    expect(row).toMatchObject({ recordedBy: "member", purpose: "marketing", noticeVersion: "notice-v1", occurredAt: new Date(proof.occurredAt) });
    expect(row.recordedAt.getTime()).toBeGreaterThan(row.occurredAt.getTime());
    await recordConsent(fixture.db, "member", tenantA, contact.id, { ...proof, status: "withdrawn" });
    expect((await getContact(fixture.db, "member", tenantA, contact.id)).consents.map((event) => event.status)).toEqual(["withdrawn", "granted"]);
    await expect(withTenant(fixture.db, "member", tenantA, "contacts:write", (tx) => tx.execute(sql`insert into contact_consents (tenant_id, contact_id, recorded_by, purpose, notice_version, channel, status, source, evidence) values (${tenantA}, ${contact.id}, 'eraser-a', 'marketing', 'notice-v1', 'email', 'granted', 'source', 'evidence')`))).rejects.toThrow();
  });

  it("removes all personal values, detaches anonymous proof and leaves other tenants and contacts intact", async () => {
    const input = { name: "Private Person", email: "private@example.test", phone: "+49123456789", social: "@private", notes: "private note" };
    const a = await createContact(fixture.db, "eraser-a", tenantA, input);
    const b = await createContact(fixture.db, "eraser-b", tenantB, input);
    const untouched = await getContact(fixture.db, "eraser-b", tenantB, b.id);
    const before = await recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof);
    await recordConsent(fixture.db, "eraser-a", tenantA, a.id, { ...proof, status: "withdrawn" });
    const otherProof = await recordConsent(fixture.db, "eraser-b", tenantB, b.id, proof);
    await eraseContact(fixture.db, "eraser-a", tenantA, a.id);
    expect(await eraseContact(fixture.db, "eraser-a", tenantA, a.id)).toEqual({ erased: true });
    const { rows: [contact] } = await fixture.admin.query("select * from contacts where tenant_id=$1 and id=$2", [tenantA, a.id]);
    expect(contact).toMatchObject({ name: "Erased contact", notes: "" }); expect(contact.erased_at).toBeInstanceOf(Date);
    expect((await fixture.admin.query("select * from contact_identifiers where tenant_id=$1 and contact_id=$2", [tenantA, a.id])).rows).toEqual([]);
    const { rows: ledger } = await fixture.admin.query("select * from contact_consents where tenant_id=$1 and redacted_at is not null", [tenantA]);
    expect(ledger).toHaveLength(2);
    for (const event of ledger) {
      expect(event).toMatchObject({ contact_id: null, recorded_by: null, channel: null, source: null, evidence: null, purpose: "marketing", notice_version: "notice-v1", occurred_at: before.occurredAt });
      expect(event.recorded_at).toBeInstanceOf(Date); expect(event.redacted_at).toBeInstanceOf(Date);
      expect(event.id).not.toBe(before.id);
    }
    expect(ledger.map((event) => event.status).sort()).toEqual(["granted", "withdrawn"]);
    const stored = JSON.stringify([contact, ledger, (await fixture.admin.query("select * from audit_logs where tenant_id=$1", [tenantA])).rows]);
    for (const personal of Object.values(input)) expect(stored).not.toContain(personal);
    expect((await listContacts(fixture.db, "eraser-a", tenantA, { q: "Private Person" })).total).toBe(0);
    await expect(getContact(fixture.db, "eraser-a", tenantA, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateContact(fixture.db, "eraser-a", tenantA, a.id, input)).rejects.toMatchObject({ status: 404 });
    await expect(recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof)).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:write", (tx) => tx.execute(sql`insert into contact_identifiers (tenant_id, contact_id, kind, value, normalized_value) values (${tenantA}, ${a.id}, 'email', 'new@example.test', 'new@example.test')`))).rejects.toThrow();
    await expect(fixture.admin.query("update contacts set name='Restored' where tenant_id=$1 and id=$2", [tenantA, a.id])).rejects.toThrow("cannot be changed");
    expect(await getContact(fixture.db, "eraser-b", tenantB, b.id)).toEqual({ ...untouched, consents: [otherProof] });
  });

  it("rejects member, viewer, non-member, missing context and foreign contact erasure even through SQL", async () => {
    const a = await createContact(fixture.db, "eraser-a", tenantA, { name: "Protected" });
    for (const actor of ["member", "viewer", "eraser-b"]) await expect(eraseContact(fixture.db, actor, tenantA, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(eraseContact(fixture.db, "eraser-a", tenantB, a.id)).rejects.toMatchObject({ status: 403 });
    await expect(eraseContact(fixture.db, "eraser-b", tenantB, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(fixture.pool.query("select public.erase_contact($1,$2)", [tenantA, a.id])).rejects.toThrow("access denied");
    await expect(withTenant(fixture.db, "member", tenantA, "contacts:read", (tx) => tx.execute(sql`select public.erase_contact(${tenantA}::uuid, ${a.id}::uuid)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:read", (tx) => tx.execute(sql`select public.erase_contact(${tenantB}::uuid, ${a.id}::uuid)`))).rejects.toMatchObject({ cause: { code: "42501" } });
    expect((await getContact(fixture.db, "eraser-a", tenantA, a.id)).name).toBe("Protected");
  });

  it("keeps FORCE RLS, WITH CHECK and append-only facts even with a forged redaction flag", async () => {
    const { rows } = await fixture.admin.query("select relrowsecurity,relforcerowsecurity from pg_class where relname in ('contacts','contact_identifiers','contact_consents')");
    expect(rows).toHaveLength(3); expect(rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    const policies = await fixture.admin.query("select qual,with_check from pg_policies where tablename in ('contacts','contact_identifiers','contact_consents')");
    expect(policies.rows.every((row) => row.qual && row.with_check)).toBe(true);
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:read", async (tx) => {
      await tx.execute(sql`select set_config('app.consent_redaction', 'true', true)`);
      await tx.execute(sql`update contact_consents set evidence = null`);
    })).rejects.toThrow();
    await expect(fixture.admin.query("update contact_consents set status='withdrawn'")).rejects.toThrow("append-only");
    await expect(fixture.admin.query("delete from contact_consents")).rejects.toThrow("append-only");
    await expect(fixture.admin.query("truncate contact_consents")).rejects.toThrow("append-only");
  });

  it("rolls erasure back atomically when its audit insert fails", async () => {
    const a = await createContact(fixture.db, "eraser-a", tenantA, { name: "Rollback Person", email: "rollback@example.test", notes: "keep until success" });
    await recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof);
    const before = await getContact(fixture.db, "eraser-a", tenantA, a.id);
    await fixture.admin.query("create function test_erasure_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action = 'contact.erase' then raise exception 'test audit failure'; end if; return NEW; end $$");
    await fixture.admin.query("create trigger test_erasure_audit_failure before insert on audit_logs for each row execute function test_erasure_audit_failure()");
    try { await expect(eraseContact(fixture.db, "eraser-a", tenantA, a.id)).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger test_erasure_audit_failure on audit_logs"); }
    expect(await getContact(fixture.db, "eraser-a", tenantA, a.id)).toEqual(before);
  });

  it("supports a non-superuser definer with FORCE RLS and tenant checks active", async () => {
    const a = await createContact(fixture.db, "eraser-a", tenantA, { name: "Restricted owner test", email: "restricted@example.test" });
    await recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof);
    await fixture.admin.query("create role harvest_test_eraser nologin nosuperuser nobypassrls noinherit");
    restrictedRoleCreated = true;
    await fixture.admin.query("grant usage, create on schema public to harvest_test_eraser");
    await fixture.admin.query("grant select,update on contacts,contact_consents,workspace_members to harvest_test_eraser");
    await fixture.admin.query("grant select,delete on contact_identifiers to harvest_test_eraser");
    await fixture.admin.query("grant insert on audit_logs to harvest_test_eraser");
    for (const table of ["contacts", "contact_consents", "contact_identifiers", "workspace_members", "audit_logs"]) {
      await fixture.admin.query(`create policy test_restricted_erasure on ${table} to harvest_test_eraser using (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) with check (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid)`);
    }
    await fixture.admin.query("alter function public.erase_contact(uuid,uuid) owner to harvest_test_eraser");
    await fixture.admin.query("revoke create on schema public from harvest_test_eraser");
    expect(await eraseContact(fixture.db, "eraser-a", tenantA, a.id)).toEqual({ erased: true });
    const { rows } = await fixture.admin.query("select * from contact_consents where tenant_id=$1 and redacted_at is not null", [tenantA]);
    expect(rows.length).toBeGreaterThan(0);
    expect((await fixture.admin.query("select rolbypassrls,rolsuper from pg_roles where rolname='harvest_test_eraser'")).rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});
