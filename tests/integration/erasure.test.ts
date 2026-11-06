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
    for (const table of ["contacts", "contact_consents", "contact_identifiers", "contact_company_links", "crm_field_values", "crm_saved_views", "opportunities", "crm_pipeline_stages", "workspace_members", "audit_logs"]) {
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
    await expect(eraseContact(fixture.db, "eraser-a", tenantA, a.id)).rejects.toMatchObject({ status: 404 });
    const { rows: [contact] } = await fixture.admin.query("select * from contacts where tenant_id=$1 and erased_at is not null", [tenantA]);
    expect(contact).toMatchObject({ name: "Erased contact", notes: "" }); expect(contact.erased_at).toBeInstanceOf(Date);
    expect((await fixture.admin.query("select * from contact_identifiers where tenant_id=$1 and contact_id=$2", [tenantA, a.id])).rows).toEqual([]);
    const { rows: ledger } = await fixture.admin.query("select * from contact_consents where tenant_id=$1 and redacted_at is not null", [tenantA]);
    expect(ledger).toHaveLength(2);
    for (const event of ledger) {
      expect(event).toMatchObject({ contact_id: contact.id, recorded_by: null, channel: null, source: null, evidence: null, purpose: "marketing", notice_version: "notice-v1", occurred_at: new Date("2026-10-01T00:00:00Z") });
      expect(event.recorded_at.toISOString()).toMatch(/T00:00:00.000Z$/);
      expect(event.redacted_at.toISOString()).toMatch(/T00:00:00.000Z$/);
      expect(event.id).not.toBe(before.id);
    }
    expect(ledger.map((event) => event.status).sort()).toEqual(["granted", "withdrawn"]);
    const stored = JSON.stringify([contact, ledger, (await fixture.admin.query("select * from audit_logs where tenant_id=$1", [tenantA])).rows]);
    for (const personal of Object.values(input)) expect(stored).not.toContain(personal);
    expect((await listContacts(fixture.db, "eraser-a", tenantA, { q: "Private Person" })).total).toBe(0);
    const unfiltered = await listContacts(fixture.db, "eraser-a", tenantA);
    expect(unfiltered.rows.some((row) => row.id === a.id || row.erasedAt !== null)).toBe(false);
    expect(unfiltered.total).toBe(1); // The earlier provenance contact is still live.
    // All three precise timestamps previously exposed a path back to the audit target.
    const joined = await fixture.admin.query(`select c.id from contact_consents c join audit_logs a
      on a.tenant_id = c.tenant_id and a.created_at = any(array[c.recorded_at,c.occurred_at,c.redacted_at])
      where c.tenant_id = $1 and c.redacted_at is not null`, [tenantA]);
    expect(joined.rows).toEqual([]);
    await expect(getContact(fixture.db, "eraser-a", tenantA, a.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateContact(fixture.db, "eraser-a", tenantA, a.id, input)).rejects.toMatchObject({ status: 404 });
    await expect(recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof)).rejects.toMatchObject({ status: 404 });
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:write", (tx) => tx.execute(sql`insert into contact_identifiers (tenant_id, contact_id, kind, value, normalized_value) values (${tenantA}, ${a.id}, 'email', 'new@example.test', 'new@example.test')`))).rejects.toThrow();
    await expect(fixture.admin.query("update contacts set name='Restored' where tenant_id=$1 and id=$2", [tenantA, contact.id])).rejects.toThrow("cannot be changed");
    expect(await getContact(fixture.db, "eraser-b", tenantB, b.id)).toEqual({ ...untouched, consents: [otherProof], effectiveConsents: [otherProof] });
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

  it("denies a dual owner's erasure in B when the transaction context is A", async () => {
    const b = (await createWorkspace(fixture.db, "eraser-a", "Dual owner B")).tenantId;
    const contact = await createContact(fixture.db, "eraser-a", b, { name: "Dual owner protected" });
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:erase", (tx) =>
      tx.execute(sql`select public.erase_contact(${b}::uuid, ${contact.id}::uuid)`)
    )).rejects.toMatchObject({ cause: { code: "42501" } });
    expect((await getContact(fixture.db, "eraser-a", b, contact.id)).erasedAt).toBeNull();
  });

  it("coarsens permitted midnight clock skew in UTC while preserving the occurrence bound", async () => {
    const contact = await createContact(fixture.db, "eraser-a", tenantA, { name: "Midnight skew" });
    // Historical clock-skew fixture belongs to the migration owner, never the app role.
    const client = await fixture.admin.connect();
    try {
      await client.query("begin");
      await client.query("alter table contact_consents disable trigger consent_provenance");
      await client.query(`insert into contact_consents (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence,recorded_at,occurred_at)
        values ($1,$2,'eraser-a','marketing','notice-v1','email','granted','reference','reference',
          '2026-10-01T23:59:00Z','2026-10-02T00:01:00Z')`, [tenantA, contact.id]);
      await client.query("alter table contact_consents enable trigger consent_provenance");
      await client.query("commit");
    } catch (error) { await client.query("rollback"); throw error; }
    finally { client.release(); }
    await eraseContact(fixture.db, "eraser-a", tenantA, contact.id);
    const { rows: [row] } = await fixture.admin.query("select recorded_at,occurred_at,redacted_at from contact_consents where tenant_id=$1 and redacted_at is not null and recorded_at='2026-10-01T00:00:00Z'", [tenantA]);
    expect(row.recorded_at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(row.occurred_at.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(row.redacted_at.toISOString()).toMatch(/T00:00:00.000Z$/);
  });

  it("rejects a migration-owner redaction that changes consent status", async () => {
    const contact = await createContact(fixture.db, "eraser-a", tenantA, { name: "Immutable status" });
    const consent = await recordConsent(fixture.db, "eraser-a", tenantA, contact.id, proof);
    const client = await fixture.admin.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true), set_config('app.user_id', 'eraser-a', true)", [tenantA]);
      await client.query("update contacts set name='Erased contact', notes='', erased_at=now() where tenant_id=$1 and id=$2", [tenantA, contact.id]);
      await expect(client.query(`update contact_consents set id=gen_random_uuid(), contact_id=null, recorded_by=null,
        channel=null, source=null, evidence=null, status='withdrawn',
        recorded_at=date_trunc('day',recorded_at,'UTC'), occurred_at=date_trunc('day',occurred_at,'UTC'),
        redacted_at=date_trunc('day',now(),'UTC') where tenant_id=$1 and id=$2`, [tenantA, consent.id])).rejects.toThrow("append-only");
    } finally { await client.query("rollback"); client.release(); }
    expect((await getContact(fixture.db, "eraser-a", tenantA, contact.id)).consents[0].status).toBe("granted");
  });

  it.each([
    ["legacy_unspecified", "notice-v1"], ["marketing", "legacy-unversioned"],
  ])("rejects new app-role consent using legacy provenance %s / %s", async (purpose, version) => {
    const contact = await createContact(fixture.db, "eraser-a", tenantA, { name: "Legacy provenance denied" });
    await expect(withTenant(fixture.db, "eraser-a", tenantA, "contacts:write", (tx) => tx.execute(sql`
      insert into contact_consents (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence)
      values (${tenantA},${contact.id},'eraser-a',${purpose},${version},'email','granted','reference','reference')`
    ))).rejects.toMatchObject({ cause: { message: "invalid consent provenance" } });
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
    const beforeAudit = (await fixture.admin.query("select * from audit_logs where tenant_id=$1 order by id", [tenantA])).rows;
    await fixture.admin.query("create function test_erasure_audit_failure() returns trigger language plpgsql as $$ begin if NEW.action = 'contact.erase' then raise exception 'test audit failure'; end if; return NEW; end $$");
    await fixture.admin.query("create trigger test_erasure_audit_failure before insert on audit_logs for each row execute function test_erasure_audit_failure()");
    try { await expect(eraseContact(fixture.db, "eraser-a", tenantA, a.id)).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger test_erasure_audit_failure on audit_logs"); }
    expect(await getContact(fixture.db, "eraser-a", tenantA, a.id)).toEqual(before);
    expect((await fixture.admin.query("select * from audit_logs where tenant_id=$1 order by id", [tenantA])).rows).toEqual(beforeAudit);
  });

  it("supports a non-superuser definer with FORCE RLS and tenant checks active", async () => {
    const a = await createContact(fixture.db, "eraser-a", tenantA, { name: "Restricted owner test", email: "restricted@example.test" });
    await recordConsent(fixture.db, "eraser-a", tenantA, a.id, proof);
    await fixture.admin.query("create role harvest_test_eraser nologin nosuperuser nobypassrls noinherit");
    restrictedRoleCreated = true;
    await fixture.admin.query("grant usage, create on schema public to harvest_test_eraser");
    await fixture.admin.query("grant select,update on contacts,contact_consents,workspace_members to harvest_test_eraser");
    await fixture.admin.query("grant select,delete on contact_identifiers,contact_company_links,crm_field_values to harvest_test_eraser");
    await fixture.admin.query("grant select,update on crm_saved_views,opportunities to harvest_test_eraser");
    await fixture.admin.query("grant select on crm_pipeline_stages to harvest_test_eraser");
    await fixture.admin.query("grant select,insert,update on audit_logs to harvest_test_eraser");
    for (const table of ["contacts", "contact_consents", "contact_identifiers", "contact_company_links", "crm_field_values", "crm_saved_views", "opportunities", "crm_pipeline_stages", "workspace_members", "audit_logs"]) {
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
