import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createContact, eraseContact, recordConsent, updateContact } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
const proof = { channel: "email", status: "granted", purpose: "marketing", noticeVersion: "notice-v1", source: "Form", evidence: "Reference", occurredAt: "2026-10-01T12:30:00Z" } as const;
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values({ id: "audit-owner", name: "Owner", email: "audit-owner@example.test" });
});
afterAll(async () => { await fixture?.close(); });

it("unlinks every audit reference and breaks ID, timestamp, day/status and erasure-xmin paths", async () => {
  const tenant = (await createWorkspace(fixture.db, "audit-owner", "Audit unlinking")).tenantId;
  const otherTenant = (await createWorkspace(fixture.db, "audit-owner", "Unrelated audit")).tenantId;
  const contact = await createContact(fixture.db, "audit-owner", tenant, { name: "Erase me", email: "erase@example.test" });
  const other = await createContact(fixture.db, "audit-owner", tenant, { name: "Keep me" });
  await recordConsent(fixture.db, "audit-owner", tenant, other.id, { ...proof, status: "unknown" });
  await createContact(fixture.db, "audit-owner", otherTenant, { name: "Other tenant" });
  await updateContact(fixture.db, "audit-owner", tenant, contact.id, { name: "Erase updated", email: "erase@example.test" });
  const grant = await recordConsent(fixture.db, "audit-owner", tenant, contact.id, proof);
  const withdrawal = await recordConsent(fixture.db, "audit-owner", tenant, contact.id, { ...proof, status: "withdrawn" });
  // Cover consent-targeted and metadata-targeted audit forms as well as the current API's contact targets.
  await withTenant(fixture.db, "audit-owner", tenant, "contacts:write", (tx) => tx.execute(sql`insert into audit_logs (tenant_id,actor_id,action,target_id,metadata) values
    (${tenant},'audit-owner','consent.record',${grant.id},${JSON.stringify({ consentId: grant.id, channel: "email", status: "granted" })}::jsonb),
    (${tenant},'audit-owner','consent.record',null,${JSON.stringify({ contactId: contact.id, consentId: withdrawal.id, status: "withdrawn" })}::jsonb)`));
  const before = (await fixture.admin.query("select * from audit_logs order by id")).rows;
  const affected = before.filter((row) => row.target_id === contact.id || row.target_id === grant.id || row.metadata.contactId === contact.id);
  expect(affected).toHaveLength(6);
  const untouched = before.filter((row) => !affected.includes(row));
  // Prove the pre-erasure fixture exposes the original day/status linkage.
  expect((await fixture.admin.query(`select c.id from contact_consents c join audit_logs a
    on a.tenant_id=c.tenant_id and a.metadata->>'status'=c.status
      and date_trunc('day',a.created_at,'UTC')=date_trunc('day',c.recorded_at,'UTC')
    where c.tenant_id=$1 and c.contact_id=$2`, [tenant, contact.id])).rowCount).toBeGreaterThan(0);

  await eraseContact(fixture.db, "audit-owner", tenant, contact.id);
  await eraseContact(fixture.db, "audit-owner", tenant, contact.id);
  const after = (await fixture.admin.query("select * from audit_logs order by id")).rows;
  for (const row of affected) expect(after.find((audit) => audit.id === row.id)).toEqual({ ...row, target_id: null, metadata: {} });
  for (const row of untouched) expect(after.find((audit) => audit.id === row.id)).toEqual(row);
  const erasures = after.filter((row) => row.tenant_id === tenant && row.action === "contact.erase");
  expect(erasures).toHaveLength(1);
  expect(erasures[0]).toMatchObject({ target_id: null, metadata: {} });
  const ledger = (await fixture.admin.query("select * from contact_consents where tenant_id=$1 and redacted_at is not null", [tenant])).rows;
  expect(ledger).toHaveLength(2);
  expect(ledger.every((row) => ![grant.id, withdrawal.id].includes(row.id) && row.contact_id === null)).toBe(true);
  for (const id of [contact.id, grant.id, withdrawal.id]) expect(JSON.stringify(after)).not.toContain(id);
  const joins = await fixture.admin.query(`select c.id from contact_consents c join audit_logs a on a.tenant_id=c.tenant_id and (
      a.target_id=c.id::text or a.metadata->>'consentId'=c.id::text
      or a.created_at=any(array[c.recorded_at,c.occurred_at,c.redacted_at])
      or (a.metadata->>'status'=c.status and date_trunc('day',a.created_at,'UTC')=any(array[c.recorded_at,c.occurred_at,c.redacted_at]))
    ) where c.tenant_id=$1 and c.redacted_at is not null`, [tenant]);
  expect(joins.rows).toEqual([]);
  // Physical transaction matches carry neither a contact target nor correlating metadata.
  expect((await fixture.admin.query(`select a.id from contact_consents c join audit_logs a on a.xmin=c.xmin
    where c.tenant_id=$1 and c.redacted_at is not null and (a.target_id is not null or a.metadata <> '{}'::jsonb)`, [tenant])).rows).toEqual([]);
});

it("keeps audit UPDATE privileges and all other mutation paths closed", async () => {
  const tenant = (await createWorkspace(fixture.db, "audit-owner", "Audit guard")).tenantId;
  const contact = await createContact(fixture.db, "audit-owner", tenant, { name: "Live" });
  await expect(withTenant(fixture.db, "audit-owner", tenant, "contacts:write", async (tx) => {
    await tx.execute(sql`select set_config('app.audit_redaction','true',true)`);
    await tx.execute(sql`update audit_logs set target_id=null,metadata='{}' where target_id=${contact.id}`);
  })).rejects.toMatchObject({ cause: { code: "42501" } });
  const client = await fixture.admin.connect();
  try {
    await client.query("select set_config('app.tenant_id',$1,false)", [tenant]);
    await expect(client.query("update audit_logs set target_id=null,metadata='{}' where target_id=$1", [contact.id])).rejects.toThrow("append-only");
    await eraseContact(fixture.db, "audit-owner", tenant, contact.id);
    for (const change of ["action='changed'", "actor_id='audit-owner',created_at=now()", "target_id='restored'", `metadata='{"status":"withdrawn"}'::jsonb`]) {
      await expect(client.query(`update audit_logs set ${change} where tenant_id=$1 and action='contact.erase'`, [tenant])).rejects.toThrow("append-only");
    }
    await expect(client.query("delete from audit_logs")).rejects.toThrow("append-only");
    await expect(client.query("truncate audit_logs")).rejects.toThrow("append-only");
  } finally {
    await client.query("select set_config('app.tenant_id','',false)"); client.release();
  }
});
