import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { testDatabase } from "../database";
import * as schema from "../../src/db/schema";
import { campaigns, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign, getCampaign, listCampaigns } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenantA: string, tenantB: string, campaignA: string, campaignB: string;
const input = { name: "Synthetic summer outreach", type: "local_outreach" };
const raw = (tenantId: string, ownerUserId: string) => ({ tenantId, ownerUserId, name: "Raw draft", type: "conference" as const, idempotencyKey: randomUUID(), fingerprint: "a".repeat(64) });
// RLS can mask a removed service predicate. Inspect the real executed SQL and
// its bound tenant value independently of what PostgreSQL allows it to return.
function serviceQueries() {
  const reads: { query: string; params: unknown[] }[] = [];
  const db = drizzle(fixture.pool, { schema, logger: { logQuery(query, params) {
    if (query.startsWith("select ") && query.includes('from "campaigns"')) reads.push({ query, params });
  } } });
  return { db, expectTenantReads(count: number) {
    expect(reads).toHaveLength(count);
    for (const { query, params } of reads) {
      const predicate = query.split(" where ")[1]?.match(/"campaigns"\."tenant_id" = \$(\d+)/);
      expect(predicate, "every campaign service SELECT must bind its tenant in WHERE").toBeTruthy();
      expect(params[Number(predicate![1]) - 1]).toBe(tenantA);
    }
  } };
}
beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-a", "owner-b", "member-a", "admin-a", "viewer-a", "outsider"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(fixture.db, "owner-a", "Campaign A")).tenantId;
  tenantB = (await createWorkspace(fixture.db, "owner-b", "Campaign B")).tenantId;
  for (const [user, role] of [["member-a", "member"], ["admin-a", "admin"], ["viewer-a", "viewer"]] as const) await putMember(fixture.db, "owner-a", tenantA, `${user}@example.test`, role);
  campaignA = (await createCampaign(fixture.db, "member-a", tenantA, input, "same-key")).id;
  campaignB = (await createCampaign(fixture.db, "owner-b", tenantB, input, "same-key")).id;
});
afterAll(async () => { await fixture?.close(); });

describe("CW-01 campaign tenancy and creation", () => {
  it("forces RLS, uses a tenant composite PK, and grants no mutation/public access", async () => {
    expect((await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where oid='campaigns'::regclass")).rows)
      .toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
    expect((await fixture.admin.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='campaigns'::regclass and contype='p'")).rows)
      .toEqual([{ definition: "PRIMARY KEY (tenant_id, id)" }]);
    const grants = await fixture.admin.query("select has_table_privilege('harvest_app','campaigns','UPDATE') as update, has_table_privilege('harvest_app','campaigns','DELETE') as delete");
    expect(grants.rows).toEqual([{ update: false, delete: false }]);
    expect((await fixture.admin.query("select roles = ARRAY['harvest_app']::name[] as runtime_only from pg_policies where tablename='campaigns' and policyname <> 'connect_definer_campaign_read'")).rows)
      .toEqual([{ runtime_only: true }, { runtime_only: true }]);
    // HC-03: the only other policy is the link definers' read-only, tenant/code-scoped one for the
    // migration owner (who obeys FORCE RLS); never harvest_app or PUBLIC, never a write.
    expect((await fixture.admin.query("select cmd, roles = ARRAY[current_user]::name[] as owner_only, qual like '%current_setting%' as scoped from pg_policies where tablename='campaigns' and policyname = 'connect_definer_campaign_read'")).rows)
      .toEqual([{ cmd: "SELECT", owner_only: true, scoped: true }]);
  });
  it("starts as an unpublished draft owned by the creator and adds no workspace", async () => {
    expect(await getCampaign(fixture.db, "viewer-a", tenantA, campaignA)).toMatchObject({ ownerUserId: "member-a", status: "draft", tenantId: tenantA, name: input.name });
    expect((await fixture.admin.query("select count(*)::int as count from workspaces")).rows[0].count).toBe(2);
    expect((await fixture.admin.query("select actor_id, metadata from audit_logs where action='campaign.create' and target_id=$1", [campaignA])).rows)
      .toEqual([{ actor_id: "member-a", metadata: {} }]);
  });
  it("binds the tenant filter on both campaign list and count service queries", async () => {
    const queries = serviceQueries();
    expect((await listCampaigns(queries.db, "owner-a", tenantA)).campaigns.map((row) => row.id)).toEqual([campaignA]);
    queries.expectTenantReads(2);
  });
  it("binds the tenant filter on the campaign get service query", async () => {
    const queries = serviceQueries();
    expect((await getCampaign(queries.db, "owner-a", tenantA, campaignA)).id).toBe(campaignA);
    queries.expectTenantReads(1);
  });
  it("binds the tenant filter on the campaign idempotency service reread", async () => {
    const queries = serviceQueries();
    expect((await createCampaign(queries.db, "member-a", tenantA, input, "same-key")).id).toBe(campaignA);
    queries.expectTenantReads(1);
  });
  it("isolates list/get in both directions and denies hostile workspace hints", async () => {
    for (const [user, own, foreign, ownId, foreignId] of [["owner-a", tenantA, tenantB, campaignA, campaignB], ["owner-b", tenantB, tenantA, campaignB, campaignA]]) {
      expect((await listCampaigns(fixture.db, user, own)).campaigns.map((row) => row.id)).toEqual([ownId]);
      await expect(getCampaign(fixture.db, user, own, foreignId)).rejects.toMatchObject({ status: 404 });
      await expect(getCampaign(fixture.db, user, own, randomUUID())).rejects.toMatchObject({ status: 404 });
      await expect(getCampaign(fixture.db, user, foreign, foreignId)).rejects.toMatchObject({ status: 403 });
      await expect(listCampaigns(fixture.db, user, foreign)).rejects.toMatchObject({ status: 403 });
      await expect(createCampaign(fixture.db, user, foreign, input, "foreign")).rejects.toMatchObject({ status: 403 });
      await withTenant(fixture.db, user, own, "campaigns:read", async (tx) => {
        expect((await tx.select().from(campaigns)).map((row) => row.id)).toEqual([ownId]);
        expect(await tx.select().from(campaigns).where(eq(campaigns.id, foreignId))).toEqual([]);
      });
      await expect(withTenant(fixture.db, user, own, "campaigns:write", (tx) => tx.insert(campaigns).values(raw(foreign, user)))).rejects.toThrow();
    }
  });
  it("denies non-members and signed-out callers; viewers read but cannot create", async () => {
    for (const user of ["outsider", ""]) {
      const status = user ? 403 : 401;
      await expect(listCampaigns(fixture.db, user, tenantA)).rejects.toMatchObject({ status });
      await expect(getCampaign(fixture.db, user, tenantA, campaignA)).rejects.toMatchObject({ status });
      await expect(createCampaign(fixture.db, user, tenantA, input, "denied")).rejects.toMatchObject({ status });
    }
    expect((await listCampaigns(fixture.db, "viewer-a", tenantA)).total).toBe(1);
    await expect(createCampaign(fixture.db, "viewer-a", tenantA, input, "denied")).rejects.toMatchObject({ status: 403 });
    await expect(withTenant(fixture.db, "viewer-a", tenantA, "campaigns:read", (tx) => tx.insert(campaigns).values(raw(tenantA, "viewer-a")))).rejects.toThrow();
  });
  it("denies omitted context and non-members even when app.tenant_id is supplied", async () => {
    expect(await fixture.db.select().from(campaigns)).toEqual([]);
    await expect(fixture.db.insert(campaigns).values(raw(tenantA, "owner-a"))).rejects.toThrow();
    for (const user of ["outsider", ""]) await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantA}, true), set_config('app.user_id', ${user}, true)`);
      expect(await tx.select().from(campaigns)).toEqual([]);
      await expect(tx.insert(campaigns).values(raw(tenantA, user || "owner-a"))).rejects.toThrow();
    });
  });
  it("reads zero campaigns with a member user context but an empty tenant context", async () => {
    await fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', 'owner-a', true), set_config('app.tenant_id', '', true)`);
      expect(await tx.select().from(campaigns)).toEqual([]);
    });
  });
  it("rejects campaign inserts with a member user context but an empty tenant context", async () => {
    // Assert the PostgreSQL RLS code, not an unrelated validation/permission error.
    await expect(fixture.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', 'owner-a', true), set_config('app.tenant_id', '', true)`);
      await tx.insert(campaigns).values(raw(tenantA, "owner-a"));
    })).rejects.toMatchObject({ cause: { code: "42501", message: 'new row violates row-level security policy for table "campaigns"' } });
  });
  it("refuses owner spoofing, activation, updating, deletion and invalid SQL values", async () => {
    await expect(withTenant(fixture.db, "owner-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns).values(raw(tenantA, "owner-b")))).rejects.toThrow();
    for (const change of [{ type: "invalid" }, { status: "active" }, { startDate: "2027-03-02", endDate: "2027-03-01" }, { name: " " }]) {
      await expect(withTenant(fixture.db, "owner-a", tenantA, "campaigns:write", (tx) => tx.insert(campaigns).values({ ...raw(tenantA, "owner-a"), ...change } as typeof campaigns.$inferInsert))).rejects.toThrow();
    }
    await expect(withTenant(fixture.db, "owner-a", tenantA, "campaigns:write", (tx) => tx.update(campaigns).set({ name: "Hijack" }).where(eq(campaigns.id, campaignA)))).rejects.toThrow();
    await expect(withTenant(fixture.db, "owner-a", tenantA, "campaigns:write", (tx) => tx.delete(campaigns).where(eq(campaigns.id, campaignA)))).rejects.toThrow();
  });
  it("retries once, scopes keys by tenant, and conflicts on payload or creator changes", async () => {
    const retried = await createCampaign(fixture.db, "member-a", tenantA, { ...input, description: "  " }, "same-key");
    expect(retried.id).toBe(campaignA);
    expect(retried).not.toHaveProperty("fingerprint"); expect(retried).not.toHaveProperty("idempotencyKey");
    expect(campaignA).not.toBe(campaignB);
    await expect(createCampaign(fixture.db, "member-a", tenantA, { ...input, name: "Changed" }, "same-key")).rejects.toMatchObject({ status: 409 });
    await expect(createCampaign(fixture.db, "admin-a", tenantA, input, "same-key")).rejects.toMatchObject({ status: 409 });
    expect((await fixture.admin.query("select count(*)::int as count from audit_logs where action='campaign.create' and target_id=$1", [campaignA])).rows[0].count).toBe(1);
  });
  it("serializes concurrent retries over independent connections", async () => {
    const pool = new Pool({ connectionString: fixture.appURL, max: 4 });
    try {
      const db = drizzle(pool, { schema });
      const rows = await Promise.all(Array.from({ length: 4 }, () => createCampaign(db, "owner-a", tenantA, input, "concurrent")));
      expect(new Set(rows.map((row) => row.id)).size).toBe(1);
      expect((await fixture.admin.query("select count(*)::int as count from audit_logs where action='campaign.create' and target_id=$1", [rows[0].id])).rows[0].count).toBe(1);
    } finally { await pool.end(); }
  });
  it("rolls back campaign creation if its audit insert fails", async () => {
    await fixture.admin.query("create function fail_campaign_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'campaign.create' then raise exception 'synthetic audit failure'; end if; return NEW; end $$; create trigger fail_campaign_audit before insert on audit_logs for each row execute function fail_campaign_audit()");
    try { await expect(createCampaign(fixture.db, "owner-a", tenantA, input, "audit-rollback")).rejects.toThrow(); }
    finally { await fixture.admin.query("drop trigger fail_campaign_audit on audit_logs; drop function fail_campaign_audit()"); }
    expect((await fixture.admin.query("select id from campaigns where idempotency_key='audit-rollback'")).rows).toEqual([]);
  });
  it("resets context on the same backend after commit and rollback", async () => {
    const pid = (await fixture.pool.query("select pg_backend_pid() as pid")).rows[0].pid;
    await withTenant(fixture.db, "owner-a", tenantA, "campaigns:read", async (tx) => {
      expect((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid).toBe(pid);
      expect(await tx.select().from(campaigns)).not.toEqual([]);
    });
    expect(await fixture.db.select().from(campaigns)).toEqual([]);
    await expect(withTenant(fixture.db, "owner-b", tenantB, "campaigns:read", async (tx) => {
      expect((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid).toBe(pid);
      throw new Error("SYNTHETIC_ROLLBACK");
    })).rejects.toThrow("SYNTHETIC_ROLLBACK");
    expect(await fixture.db.select().from(campaigns)).toEqual([]);
    expect((await fixture.pool.query("select pg_backend_pid() as pid")).rows[0].pid).toBe(pid);
  });
  it("paginates deterministically with tenant-local totals", async () => {
    for (let i = 0; i < 21; i++) await createCampaign(fixture.db, "owner-b", tenantB, { ...input, name: `Draft ${i}` }, `page-${i}`);
    const first = await listCampaigns(fixture.db, "owner-b", tenantB), second = await listCampaigns(fixture.db, "owner-b", tenantB, 2);
    expect(first).toMatchObject({ total: 22, pageSize: 20 }); expect(first.campaigns).toHaveLength(20); expect(second.campaigns).toHaveLength(2);
    expect(new Set([...first.campaigns, ...second.campaigns].map((row) => row.id)).size).toBe(22);
    expect(await withTenant(fixture.db, "owner-a", tenantA, "campaigns:read", (tx) => tx.select().from(campaigns).where(and(eq(campaigns.tenantId, tenantB), eq(campaigns.id, campaignB))))).toEqual([]);
  });
});

it("upgrades the 0020 baseline without changing existing workspaces or contacts", async () => {
  const tenant = randomUUID(), contact = randomUUID();
  const upgraded = await testDatabase({ beforeCampaignMigration: async (admin) => {
    await admin.query("insert into users (id,name,email) values ('upgrade-owner','Synthetic owner','upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Existing workspace','upgrade-owner')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'upgrade-owner','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Existing person')", [tenant, contact]);
  } });
  try {
    expect((await upgraded.admin.query("select name from contacts where tenant_id=$1 and id=$2", [tenant, contact])).rows).toEqual([{ name: "Existing person" }]);
    expect((await listCampaigns(upgraded.db, "upgrade-owner", tenant)).campaigns).toEqual([]);
    const campaign = await createCampaign(upgraded.db, "upgrade-owner", tenant, input, "upgrade");
    expect(await getCampaign(upgraded.db, "upgrade-owner", tenant, campaign.id)).toMatchObject({ status: "draft", ownerUserId: "upgrade-owner" });
  } finally { await upgraded.close(); }
});
