import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { dec2Fixture, SECRETS } from "./hc-dec2-fixture";
import { withTenant, withUser } from "../../src/server/tenancy";
import { eraseConnectResponse, listPendingResponsePage, listPendingResponseSummaries, purgeExpiredConnectResponses, withdrawConnectResponsePurpose } from "../../src/server/connect-responses";

// HC-DEC2 engineering (direction only, gate UNAPPROVED): pending-response metadata is owner/admin only, read through one
// audited definer, denied identically to every other role and tenant, and audited with counts only.
vi.mock("server-only", () => ({}));
let ctx: Awaited<ReturnType<typeof dec2Fixture>>, response: string, second: string;
let currentUser: string | null = null;
vi.mock("@/server/http", async (original) => ({ ...(await original<typeof import("../../src/server/http")>()),
  verifiedUser: async () => { if (!currentUser) { const { AccessError } = await import("../../src/server/permissions"); throw new AccessError(401, "Sign in to continue."); } return currentUser; } }));
vi.mock("@/db/client", () => ({ getDb: () => ctx.f.db }));

const fn = "public.read_pending_response_metadata";
const call = (user: string, tenant: string, campaign: string, hint = tenant) => withTenant(ctx.f.db, user, hint, "workspace:read", (tx) => tx.execute(sql`select * from public.read_pending_response_metadata(${tenant}::uuid, ${campaign}::uuid)`));
async function get(user: string | null, tenant: string, campaign: string, query = "") {
  currentUser = user;
  const { GET } = await import("../../src/app/api/workspaces/[tenantId]/campaigns/[campaignId]/connect/responses/route");
  const res = await GET(new Request(`https://example.test/api${query}`), { params: Promise.resolve({ tenantId: tenant, campaignId: campaign }) });
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
      expect(Object.keys(rows[0]).sort()).toEqual(["active_purposes", "cursor_key", "expires_at", "form_version_id", "has_more", "link_id", "notice_version_id", "response_id", "status", "submitted_at"]);
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

  it("drops the inert consents policy and keeps application access to consents and pending rows denied", async () => {
    expect((await ctx.f.admin.query("select polname from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'campaign_response_consents' order by 1")).rows.map((row) => row.polname)).toEqual(["erasure_owner_tenant"]);
    expect((await ctx.f.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where relname = 'campaign_response_consents'")).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    // Even a re-granted SELECT would find no policy for the application role.
    await ctx.f.admin.query("grant select on campaign_response_consents to harvest_app");
    try {
      expect((await withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`select id from campaign_response_consents`))).rows).toEqual([]);
    } finally { await ctx.f.admin.query("revoke select on campaign_response_consents from harvest_app"); }
    await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql`select id from campaign_response_consents`))).rejects.toMatchObject({ cause: { code: "42501" } });
    // Only the five-argument function exists, executable by the application role and not PUBLIC.
    expect((await ctx.f.admin.query("select pg_get_function_identity_arguments(oid) as args, has_function_privilege('public', oid, 'EXECUTE') as p, has_function_privilege('harvest_app', oid, 'EXECUTE') as a from pg_proc where proname = 'read_pending_response_metadata'")).rows)
      .toEqual([{ args: "p_tenant uuid, p_campaign uuid, p_limit integer, p_after_submitted timestamp with time zone, p_after_id uuid", p: false, a: true }]);
  });

  it("is not callable by PUBLIC and is the only application route to pending rows", async () => {
    expect((await ctx.f.admin.query("select has_function_privilege('public', 'public.read_pending_response_metadata(uuid,uuid,integer,timestamptz,uuid)', 'EXECUTE') as p, has_function_privilege('harvest_app', 'public.read_pending_response_metadata(uuid,uuid,integer,timestamptz,uuid)', 'EXECUTE') as a")).rows[0]).toEqual({ p: false, a: true });
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
      const { items: rows, nextCursor } = JSON.parse(body) as { items: Record<string, unknown>[]; nextCursor: string | null };
      expect(rows).toHaveLength(2); expect(nextCursor).toBeNull();
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
    const none = JSON.stringify({ items: [], nextCursor: null });
    expect(own).toMatchObject({ status: 200, body: none }); expect(empty).toMatchObject({ status: 200, body: none }); expect(unknown).toMatchObject({ status: 200, body: none });
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

describe("paging", () => {
  let paged: string; let ids: string[];
  const page = async (user: string, args: string) => (await withTenant(ctx.f.db, user, ctx.tenantA, "workspace:read", (tx) => tx.execute(sql.raw(`select * from ${fn}('${ctx.tenantA}', '${paged}'${args})`)))).rows as { response_id: string; cursor_key: string; has_more: boolean; submitted_at: Date }[];
  beforeAll(async () => {
    paged = (await (await import("../../src/server/campaigns")).createCampaign(ctx.f.db, "d-owner", ctx.tenantA, { name: "Paged", type: "evangelistic_crusade" }, "dec2-paged")).id;
    const pagedLink = (await ctx.f.admin.query("insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, created_by) values ($1,$2,$3,$4,'d-owner') returning id", [ctx.tenantA, paged, ctx.version, randomUUID().replaceAll("-", "")])).rows[0].id;
    await ctx.f.admin.query("update campaign_response_links set status = 'published' where id = $1", [pagedLink]);
    // 205 pending rows; the first three share one submitted time so that the id tiebreak is exercised.
    const { rows } = await ctx.f.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id)
      select $1, $2, $3, $4, gen_random_uuid() from generate_series(1, 205) returning id`, [ctx.tenantA, paged, pagedLink, ctx.version]);
    ids = rows.map((row) => row.id);
    // The intake guard stamps submitted_at on insert; spread the times (microsecond steps) under the guard-disabled admin connection.
    await ctx.f.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try {
      await ctx.f.admin.query(`update campaign_responses c set submitted_at = case when o.n <= 3 then timestamptz '2026-01-01 00:00:00.123456+00' else timestamptz '2026-01-01 00:00:00+00' + o.n * interval '1 second' + o.n * interval '1 microsecond' end
        from (select id, row_number() over (order by id) n from campaign_responses where campaign_id = $1) o where c.id = o.id`, [paged]);
    } finally { await ctx.f.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
  });

  it("returns 50 by default and never more than 200, in a stable submitted-time then id order", async () => {
    const first = await page("d-owner", "");
    expect(first).toHaveLength(50); expect(first[0].has_more).toBe(true);
    const max = await page("d-owner", ", 100000");
    expect(max).toHaveLength(200); expect(max[0].has_more).toBe(true);
    expect(await page("d-owner", ", 0")).toHaveLength(1); // clamped, never unbounded
    const key = max.map((row) => `${new Date(row.submitted_at).getTime()}|${row.response_id}`);
    expect(key).toEqual([...key].sort((a, b) => { const [at, ai] = a.split("|"), [bt, bi] = b.split("|"); return Number(at) - Number(bt) || (ai < bi ? -1 : ai > bi ? 1 : 0); }));
    const tied = (await ctx.f.admin.query("select id from campaign_responses where campaign_id = $1 and submitted_at = timestamptz '2026-01-01 00:00:00.123456+00' order by id", [paged])).rows.map((row) => row.id);
    expect(tied).toHaveLength(3); expect(max.slice(0, 3).map((row) => row.response_id)).toEqual(tied);
  });

  it("walks every row exactly once with the service cursor, including rows that share a timestamp", async () => {
    const seen: string[] = []; let cursor: string | undefined; let pages = 0;
    do {
      const result = await listPendingResponsePage(ctx.f.db, "d-owner", ctx.tenantA, paged, { limit: 60, cursor }); pages += 1;
      seen.push(...result.items.map((item) => item.id)); cursor = result.nextCursor ?? undefined;
    } while (cursor);
    expect(pages).toBe(4); expect(seen).toHaveLength(205); expect(new Set(seen)).toEqual(new Set(ids));
    expect((await listPendingResponseSummaries(ctx.f.db, "d-owner", ctx.tenantA, paged))).toHaveLength(50);
    // A page boundary inside the three rows that share a microsecond-exact timestamp loses and repeats nothing.
    const a = await listPendingResponsePage(ctx.f.db, "d-owner", ctx.tenantA, paged, { limit: 2 });
    const b = await listPendingResponsePage(ctx.f.db, "d-owner", ctx.tenantA, paged, { limit: 2, cursor: a.nextCursor! });
    expect([...a.items, ...b.items.slice(0, 1)].map((item) => item.id)).toEqual(seen.slice(0, 3));
  });

  it("serves the API pages and rejects malformed limit and cursor with 400", async () => {
    const one = await get("d-owner", ctx.tenantA, paged, "?limit=100");
    expect(one.status).toBe(200);
    const first = JSON.parse(one.body) as { items: unknown[]; nextCursor: string };
    expect(first.items).toHaveLength(100); expect(first.nextCursor).toEqual(expect.any(String));
    const next = JSON.parse((await get("d-owner", ctx.tenantA, paged, `?limit=200&cursor=${first.nextCursor}`)).body) as { items: unknown[]; nextCursor: string | null };
    expect(next.items).toHaveLength(105); expect(next.nextCursor).toBeNull();
    expect(JSON.parse((await get("d-owner", ctx.tenantA, paged, "?limit=5000")).body).items).toHaveLength(200);
    const bad = ["?limit=abc", "?limit=0", "?limit=-1", "?limit=1.5", "?limit=", "?limit=99999999999", "?cursor=!!!", "?cursor=", "?cursor=e30", `?cursor=${Buffer.from(JSON.stringify(["x", randomUUID()])).toString("base64url")}`,
      `?cursor=${Buffer.from(JSON.stringify(["2026-01-01 00:00:00+00", "nope"])).toString("base64url")}`, `?cursor=${"a".repeat(300)}`];
    for (const query of bad) expect({ query, status: (await get("d-owner", ctx.tenantA, paged, query)).status }).toEqual({ query, status: 400 });
  });

  it("denies every denied caller identically whatever the page arguments, and audits one counts-only row per call", async () => {
    const denials = [await get("d-member", ctx.tenantA, paged, "?limit=5"), await get("d-viewer", ctx.tenantA, paged), await get("d-other", ctx.tenantA, paged, "?limit=200"), await get("d-member", ctx.tenantA, randomUUID())];
    for (const denial of denials) expect(denial).toEqual({ status: 403, body: denials[0].body });
    currentUser = null;
    expect((await get(null, ctx.tenantA, paged, "?limit=5")).status).toBe(401);
    const before = (await ctx.audit()).length;
    await get("d-owner", ctx.tenantA, paged, "?limit=7");
    const cursor = JSON.parse((await get("d-admin", ctx.tenantA, paged, "?limit=3")).body).nextCursor;
    await get("d-admin", ctx.tenantA, paged, `?limit=150&cursor=${cursor}`);
    await get("d-owner", ctx.tenantA, paged, "?limit=abc");
    const rows = (await ctx.audit()).slice(before);
    expect(rows.map((row) => row.metadata)).toEqual([{ count: "7" }, { count: "3" }, { count: "150" }]);
    expect(JSON.stringify(rows)).not.toMatch(/limit|cursor|nextCursor/);
    for (const id of ids.slice(0, 5)) expect(JSON.stringify(rows)).not.toContain(id);
  });

  it("rejects a half cursor at the database and keeps definers working (claim, retention, erasure, withdrawal)", async () => {
    await expect(withTenant(ctx.f.db, "d-owner", ctx.tenantA, "workspace:read", (tx) => tx.execute(sql.raw(`select * from ${fn}('${ctx.tenantA}', '${paged}', 5, now(), null)`)))).rejects.toMatchObject({ cause: { code: "22023" } });
    const target = await ctx.seedResponse();
    expect(await withdrawConnectResponsePurpose(ctx.f.db, "d-owner", ctx.tenantA, target, "newsletter")).toEqual({ outcome: "withdrawn" });
    expect(await eraseConnectResponse(ctx.f.db, "d-owner", ctx.tenantA, target)).toEqual({ erased: true });
    expect(await purgeExpiredConnectResponses(ctx.f.db, "d-owner", ctx.tenantA)).toEqual({ purged: 0 });
  });
});
