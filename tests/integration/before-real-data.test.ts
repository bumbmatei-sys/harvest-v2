import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { seedPeople } from "./social-layer-fixture";
import { createContact, getContact, recordConsent } from "../../src/server/contacts";
import { createRightsRequest, listRightsRequests, updateRightsRequest } from "../../src/server/crm-rights-requests";
import { withTenant } from "../../src/server/tenancy";
import { changeMemberAccess } from "../../src/server/access";
import { users } from "../../src/db/schema";

let f: Awaited<ReturnType<typeof testDatabase>>;
let p: Awaited<ReturnType<typeof seedPeople>>;
const collaborator = "privacy-collaborator";
const denied = (operation: Promise<unknown>) => expect(operation).rejects.toMatchObject({ status: 403 });

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  p = await seedPeople(f, "privacy", "example.invalid");
  await f.db.insert(users).values({ id: collaborator, name: "Privacy collaborator", email: "collaborator@example.invalid", emailVerified: true });
  await f.admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,$2,'viewer')", [p.tenant, collaborator]);
});
afterAll(async () => { await f?.close(); });

it("limits the contact and consent projections in both app services and direct queries", async () => {
  const person = await createContact(f.db, p.owner, p.tenant, { name: "Synthetic person", email: "person@example.invalid" });
  await recordConsent(f.db, p.owner, p.tenant, person.id, {
    status: "granted", purpose: "marketing", channel: "email", noticeVersion: "notice-v1", source: "Sensitive source", evidence: "Sensitive evidence",
  });
  for (const staff of [p.owner, p.admin]) {
    expect((await getContact(f.db, staff, p.tenant, person.id)).effectiveConsents).toMatchObject([{ source: "Sensitive source", evidence: "Sensitive evidence" }]);
  }
  const as = (user: string, statement: ReturnType<typeof sql>) => withTenant(f.db, user, p.tenant, "workspace:read", tx => tx.execute(statement));
  await denied(getContact(f.db, p.viewer, p.tenant, person.id));
  expect((await as(p.viewer, sql`select id from contacts where id = ${person.id}::uuid`)).rows).toEqual([]);
  expect((await as(p.viewer, sql`select id from contact_identifiers where contact_id = ${person.id}::uuid`)).rows).toEqual([]);
  expect((await as(p.viewer, sql`select id from contact_consents where contact_id = ${person.id}::uuid`)).rows).toEqual([]);
  await changeMemberAccess(f.db, p.owner, p.tenant, { userId: collaborator, role: "collaborator", grants: { social: "manage" } });
  await denied(getContact(f.db, collaborator, p.tenant, person.id));
  for (const level of ["view", "manage"] as const) {
    await changeMemberAccess(f.db, p.owner, p.tenant, { userId: collaborator, role: "collaborator", grants: { crm: level } });
    const contact = await getContact(f.db, collaborator, p.tenant, person.id);
    expect(contact.effectiveConsents).toMatchObject([{ source: null, evidence: null }]);
    expect(contact).not.toHaveProperty("sourceHistory");
    expect((await as(collaborator, sql`select * from public.crm_consent_evidence(${p.tenant}::uuid, ${person.id}::uuid)`)).rows).toEqual([]);
    await expect(as(collaborator, sql`select evidence from contact_consents`)).rejects.toMatchObject({ cause: { code: "42501" } });
  }
  expect((await getContact(f.db, p.member, p.tenant, person.id)).effectiveConsents).toMatchObject([{ source: null, evidence: null }]);
  expect((await as(p.owner, sql`select * from public.crm_consent_evidence(${p.other}::uuid, ${person.id}::uuid)`)).rows).toEqual([]);
});

it("records rights changes and prunes only expired rows through worker capabilities", async () => {
  for (const actor of [p.member, p.viewer, collaborator, p.outsider]) {
    await denied(listRightsRequests(f.db, actor, p.tenant, null));
  }
  const request = await createRightsRequest(f.db, p.owner, p.tenant, { kind: "access" });
  expect(request).toMatchObject({ verification: "pending", outcome: null, version: 1 });
  expect(() => updateRightsRequest(f.db, p.admin, p.tenant, { id: request.id, version: 1, verification: "pending", deadline: request.deadline.toISOString(), outcome: "fulfilled" })).toThrow();
  const patch = { id: request.id, version: 1, verification: "verified", deadline: request.deadline.toISOString(), outcome: "fulfilled" };
  expect(await updateRightsRequest(f.db, p.admin, p.tenant, patch)).toMatchObject({ version: 2, verification: "verified", outcome: "fulfilled" });
  await expect(updateRightsRequest(f.db, p.admin, p.tenant, patch)).rejects.toMatchObject({ status: 409 });
  expect((await f.admin.query("select action from audit_logs where target_id=$1 order by created_at", [request.id])).rows.map(row => row.action))
    .toEqual(["privacy.rights_create", "privacy.rights_update"]);
  const { rows: [old] } = await f.admin.query("insert into audit_logs (tenant_id, actor_id, action, created_at) values ($1,$2,'test.expired',now()-interval '13 months') returning id", [p.tenant, p.owner]);
  await f.admin.query("update crm_rights_requests set closed_at=now()-interval '4 years' where id=$1", [request.id]);
  await expect(f.admin.query("delete from audit_logs where id=$1", [old.id])).rejects.toThrow();
  await expect(f.pool.query("select public.crm_rights_retention_run(5,false)")).rejects.toMatchObject({ code: "42501" });
  await expect(f.workerPool.query("select * from crm_rights_requests")).rejects.toMatchObject({ code: "42501" });
  const health = async () => (await f.workerPool.query("select public.crm_rights_retention_health() healthy")).rows[0].healthy;
  expect(await health()).toBe(false);
  expect((await f.workerPool.query("select public.crm_rights_retention_run(5,false) r")).rows[0].r).toEqual({ rightsRequests: 1 });
  expect(await health()).toBe(true);
  // Audit retention is the consolidated runner's job (PR 348): this job leaves every audit row in place.
  expect((await f.admin.query("select id from audit_logs where id=$1", [old.id])).rowCount).toBe(1);
  expect((await f.admin.query("select action from audit_logs where target_id=$1", [request.id])).rowCount).toBeGreaterThan(0);
  for (const reset of ["blog_scope_clear()", "account_self_reset()"]) {
    const { rows: [{ def }] } = await f.admin.query(`select pg_get_functiondef('public.${reset}'::regprocedure) def`);
    expect(def).toContain("'app.rights_retention'");
    expect(def).not.toContain("app.audit_retention");
  }
  await f.workerPool.query("select public.crm_rights_retention_run(5,true)");
  expect(await health()).toBe(false);
});
