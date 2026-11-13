import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { dec2Fixture, SECRETS } from "./hc-dec2-fixture";
import { withTenant, withUser } from "../../src/server/tenancy";
import { listPendingResponseSummaries } from "../../src/server/connect-responses";

// HC-DEC2 engineering (direction only, gate UNAPPROVED): pending-response metadata is owner/admin only, read through one
// audited definer, denied identically to every other role and tenant, and audited with counts only.
vi.mock("server-only", () => ({}));
let ctx: Awaited<ReturnType<typeof dec2Fixture>>, response: string, second: string;
let currentUser: string | null = null;
vi.mock("@/server/http", async (original) => ({ ...(await original<typeof import("../../src/server/http")>()),
  verifiedUser: async () => { if (!currentUser) { const { AccessError } = await import("../../src/server/permissions"); throw new AccessError(401, "Sign in to continue."); } return currentUser; } }));
vi.mock("@/db/client", () => ({ getDb: () => ctx.f.db }));

const call = (user: string, tenant: string, campaign: string, hint = tenant) => withTenant(ctx.f.db, user, hint, "workspace:read", (tx) => tx.execute(sql`select * from public.read_pending_response_metadata(${tenant}::uuid, ${campaign}::uuid)`));
async function get(user: string | null, tenant: string, campaign: string) {
  currentUser = user;
  const { GET } = await import("../../src/app/api/workspaces/[tenantId]/campaigns/[campaignId]/connect/responses/route");
  const res = await GET(new Request("https://example.test/api"), { params: Promise.resolve({ tenantId: tenant, campaignId: campaign }) });
  return { status: res.status, body: await res.text() };
}

beforeAll(async () => {
  ctx = await dec2Fixture();
  response = await ctx.seedResponse();
  second = await ctx.seedResponse(["outreach_follow_up"]);
});
afterAll(async () => { await ctx?.f.close(); });

describe("database level", () => {
  it("lets owners and admins read minimal metadata through the definer", async () => {
    for (const user of ["d-owner", "d-admin"]) {
      const { rows } = await call(user, ctx.tenantA, ctx.campaign);
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]).sort()).toEqual(["active_purposes", "expires_at", "form_version_id", "link_id", "notice_version_id", "response_id", "status", "submitted_at"]);
      expect(rows.find((row) => row.response_id === response)).toMatchObject({ status: "pending", notice_version_id: ctx.notice, form_version_id: ctx.version, link_id: ctx.link, active_purposes: ["newsletter", "outreach_follow_up"] });
      expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${SECRETS.name}|${SECRETS.email}`));
    }
  });

  it("denies members, viewers, outsiders, forged contexts and revoked admins with 42501", async () => {
    const denied = { cause: { code: "42501" } };
    for (const user of ["d-member", "d-viewer"]) await expect(call(user, ctx.tenantA, ctx.campaign)).rejects.toMatchObject(denied);
    // The other tenant's owner cannot enter tenant A, and a forged tenant setting or argument reaches nothing.
    await expect(call("d-other", ctx.tenantA, ctx.campaign, ctx.tenantB)).rejects.toMatchObject(denied);
    await expect(withTenant(ctx.f.db, "d-other", ctx.tenantB, "workspace:read", (tx) => tx.execute(sql`select * from public.read_pending_response_metadata(${ctx.tenantA}::uuid, ${ctx.campaign}::uuid)`))).rejects.toMatchObject(denied);
    await expect(withUser(ctx.f.db, "d-other", async (tx) => { await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantA}, true)`);
      return tx.execute(sql`select * from public.read_pending_response_metadata(${ctx.tenantA}::uuid, ${ctx.campaign}::uuid)`); })).rejects.toMatchObject(denied);
    await expect(withUser(ctx.f.db, "d-owner", (tx) => tx.execute(sql`select * from public.read_pending_response_metadata(${ctx.tenantA}::uuid, ${ctx.campaign}::uuid)`))).rejects.toMatchObject(denied);
    await expect(ctx.f.db.execute(sql`select * from public.read_pending_response_metadata(${ctx.tenantA}::uuid, ${ctx.campaign}::uuid)`)).rejects.toMatchObject(denied);
    await ctx.f.admin.query("insert into users (id,name,email) values ('d-revoked','Revoked','d-revoked@example.test')");
    await ctx.f.admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'d-revoked','admin')", [ctx.tenantA]);
    await ctx.f.admin.query("delete from workspace_members where user_id = 'd-revoked'");
    await expect(withUser(ctx.f.db, "d-revoked", async (tx) => { await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantA}, true)`);
      return tx.execute(sql`select * from public.read_pending_response_metadata(${ctx.tenantA}::uuid, ${ctx.campaign}::uuid)`); })).rejects.toMatchObject(denied);
  });

  it("is not callable by PUBLIC and is the only application route to pending rows", async () => {
    expect((await ctx.f.admin.query("select has_function_privilege('public', 'public.read_pending_response_metadata(uuid,uuid)', 'EXECUTE') as p, has_function_privilege('harvest_app', 'public.read_pending_response_metadata(uuid,uuid)', 'EXECUTE') as a")).rows[0]).toEqual({ p: false, a: true });
    expect((await ctx.f.admin.query("select prosecdef, proconfig from pg_proc where proname = 'read_pending_response_metadata'")).rows[0]).toEqual({ prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"] });
    // Direct reads: owners and admins see no pending row, nobody reads evidence or contact methods, nobody sees the personal columns.
    for (const user of ["d-owner", "d-admin", "d-member", "d-viewer"]) {
      expect((await withTenant(ctx.f.db, user, ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`select id from campaign_responses`))).rows).toEqual([]);
    }
    for (const user of ["d-owner", "d-admin"]) for (const table of ["campaign_response_consents", "campaign_response_contact_methods"]) {
      await expect(withTenant(ctx.f.db, user, ctx.tenantA, "workspace:read", (tx) => tx.execute(sql.raw(`select 1 from ${table}`)))).rejects.toMatchObject({ cause: { code: "42501" } });
    }
    for (const column of ["preferred_name", "public_submission_id", "contact_id", "locale"]) {
      await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql.raw(`select ${column} from campaign_responses`)))).rejects.toMatchObject({ cause: { code: "42501" } });
    }
  });

  it("keeps non-pending rows readable to owners and admins only, as before", async () => {
    const { rows: [{ id }] } = await ctx.f.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, expires_at)
      values ($1,$2,$3,$4,$5, now() + interval '1 day') returning id`, [ctx.tenantA, ctx.campaign, ctx.link, ctx.version, randomUUID()]);
    await ctx.f.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try { await ctx.f.admin.query("update campaign_responses set status = 'erased', erased_at = now(), expires_at = null, preferred_name = null, locale = null where id = $1", [id]); }
    finally { await ctx.f.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
    const seen = async (user: string) => (await withTenant(ctx.f.db, user, ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`select id from campaign_responses where id = ${id}`))).rows;
    expect(await seen("d-owner")).toHaveLength(1); expect(await seen("d-admin")).toHaveLength(1);
    expect(await seen("d-member")).toEqual([]); expect(await seen("d-viewer")).toEqual([]);
  });
});

describe("access audit", () => {
  it("writes one counts-only audit row per allowed read, with no contact or response content", async () => {
    const before = (await ctx.audit()).length;
    await listPendingResponseSummaries(ctx.f.db, "d-owner", ctx.tenantA, ctx.campaign);
    await listPendingResponseSummaries(ctx.f.db, "d-admin", ctx.tenantA, ctx.emptyCampaign);
    const rows = (await ctx.audit()).slice(before);
    expect(rows).toEqual([
      { action: "connect.pending.read", actor_id: "d-owner", target_id: ctx.campaign, metadata: { count: "2" } },
      { action: "connect.pending.read", actor_id: "d-admin", target_id: ctx.emptyCampaign, metadata: { count: "0" } }]);
    const dump = JSON.stringify((await ctx.f.admin.query("select * from audit_logs where tenant_id = $1", [ctx.tenantA])).rows);
    for (const secret of [SECRETS.name, SECRETS.email, response, second]) expect(dump).not.toContain(secret);
  });

  it("audits through the definer even when called directly, and a denied read writes nothing", async () => {
    const before = (await ctx.audit()).length;
    await call("d-admin", ctx.tenantA, ctx.campaign);
    expect((await ctx.audit()).length).toBe(before + 1);
    for (const user of ["d-member", "d-viewer"]) await expect(call(user, ctx.tenantA, ctx.campaign)).rejects.toBeDefined();
    await expect(listPendingResponseSummaries(ctx.f.db, "d-member", ctx.tenantA, ctx.campaign)).rejects.toMatchObject({ status: 403 });
    expect((await ctx.audit()).length).toBe(before + 1);
  });

  it("keeps the audit ledger append-only for the application role", async () => {
    await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`update audit_logs set metadata = '{}'::jsonb where action = 'connect.pending.read'`))).rejects.toBeDefined();
    await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`delete from audit_logs where action = 'connect.pending.read'`))).rejects.toBeDefined();
  });
});

describe("API level", () => {
  it("answers owners and admins with metadata only", async () => {
    for (const user of ["d-owner", "d-admin"]) {
      const { status, body } = await get(user, ctx.tenantA, ctx.campaign);
      expect(status).toBe(200);
      const rows = JSON.parse(body) as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(Object.keys(rows[0]).sort()).toEqual(["activePurposes", "expiresAt", "formVersionId", "id", "linkId", "noticeVersionId", "status", "submittedAt"]);
      expect(body).not.toMatch(new RegExp(`${SECRETS.name}|${SECRETS.email}`));
    }
  });

  it("answers every other caller identically and without counts or existence signals", async () => {
    const denials = [await get("d-member", ctx.tenantA, ctx.campaign), await get("d-viewer", ctx.tenantA, ctx.campaign), await get("d-other", ctx.tenantA, ctx.campaign),
      await get("d-member", ctx.tenantA, ctx.emptyCampaign), await get("d-other", ctx.tenantA, randomUUID())];
    for (const denial of denials) expect(denial).toEqual({ status: 403, body: denials[0].body });
    expect(denials[0].body).not.toMatch(/\d|pending|count|response/i);
    const anonymous = await get(null, ctx.tenantA, ctx.campaign);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).not.toMatch(/pending|count/i);
    // Another ministry's campaign id inside the owner's own tenant reveals nothing: same empty list as a campaign without responses.
    const own = await get("d-other", ctx.tenantB, ctx.campaign), empty = await get("d-owner", ctx.tenantA, ctx.emptyCampaign), unknown = await get("d-owner", ctx.tenantA, randomUUID());
    expect(own).toMatchObject({ status: 200, body: "[]" }); expect(empty).toMatchObject({ status: 200, body: "[]" }); expect(unknown).toMatchObject({ status: 200, body: "[]" });
    expect((await get("d-owner", ctx.tenantA, "not-a-uuid")).status).toBe(400);
  });

  it("audits API reads with a count and no response data", async () => {
    const before = (await ctx.audit()).length;
    await get("d-owner", ctx.tenantA, ctx.campaign);
    await get("d-member", ctx.tenantA, ctx.campaign);
    const rows = (await ctx.audit()).slice(before);
    expect(rows).toEqual([{ action: "connect.pending.read", actor_id: "d-owner", target_id: ctx.campaign, metadata: { count: "2" } }]);
  });
});
