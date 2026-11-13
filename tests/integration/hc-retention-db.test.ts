import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";
import { CONNECT_RETENTION_POLICY, suppressSmall } from "../../src/lib/connect-retention";

// HC-DEC3/HC-DEC4 engineering (migration 0043): the retention maximum, the sweep, tombstone expiry, run log and health.
// Policy numbers are the founder's selected directions, pending legal review.
let f: Awaited<ReturnType<typeof testDatabase>>, wide: Pool;
let tenantA: string, tenantB: string, campaignA: string, campaignB: string, noticeA: string, noticeB: string, versionA: string, versionB: string, linkA: string, linkB: string, formA: string;
const rows = <T = Record<string, unknown>>(result: { rows: unknown[] }) => result.rows as T[];
const as = <T>(user: string, tenant: string, run: Parameters<typeof withTenant<T>>[4]) => withTenant(f.db, user, tenant, "workspace:read", run);
const code = () => randomBytes(16).toString("hex");
async function notice(user: string, tenant: string, body: string) {
  return as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by)
    values (${tenant}, 'connect-response', 1, 'en', ${body}, ${"0".repeat(64)}, ${user}) returning id`))[0].id);
}
async function newForm(user: string, tenant: string) {
  return as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenant}, 'Synthetic form', ${user}) returning id`))[0].id);
}
const draft = (user: string, tenant: string, formId: string, version: number, retention: number | null, noticeId: string) =>
  as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, definition, created_by)
    values (${tenant}, ${formId}, ${version}, '{newsletter}'::text[], ${noticeId}, ${retention}, '{"fields":[]}'::jsonb, ${user}) returning id`))[0].id);
async function publish(user: string, tenant: string, version: string) {
  await as(user, tenant, (tx) => tx.execute(sql`update form_versions set status = 'published', published_by = ${user} where tenant_id = ${tenant} and id = ${version}`));
}
async function link(user: string, tenant: string, campaign: string, version: string) {
  const id = await as(user, tenant, async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, locale, created_by)
    values (${tenant}, ${campaign}, ${version}, ${code()}, 'en', ${user}) returning id`))[0].id);
  await f.admin.query("update campaign_response_links set status = 'published' where tenant_id = $1 and id = $2", [tenant, id]);
  return id;
}
type Where = { tenant: string; campaign: string; link: string; version: string; notice: string };
const a = (): Where => ({ tenant: tenantA, campaign: campaignA, link: linkA, version: versionA, notice: noticeA });
const b = (): Where => ({ tenant: tenantB, campaign: campaignB, link: linkB, version: versionB, notice: noticeB });
async function seed(w: Where, name = "Synthetic Guest") {
  const { rows: [r] } = await f.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, preferred_name, locale)
    values ($1, $2, $3, $4, $5, $6, 'en') returning id`, [w.tenant, w.campaign, w.link, w.version, randomUUID(), name]);
  await f.admin.query("insert into campaign_response_contact_methods (tenant_id, response_id, kind, value, normalized_value) values ($1, $2, 'email', 'guest@example.test', 'guest@example.test')", [w.tenant, r.id]);
  await f.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind)
    values ($1, $2, 'newsletter', 'granted', 'email', $3, $4, 'subject')`, [w.tenant, r.id, w.version, w.notice]);
  return r.id as string;
}
const expire = (id: string) => f.admin.query("update campaign_responses set expires_at = now() - interval '1 hour' where id = $1", [id]);
const ageTombstone = (id: string, days: number) => f.admin.query("update campaign_responses set erased_at = date_trunc('day', now() - make_interval(days => $2)) where id = $1", [id, days]);
const sweep = async (limit = 200) => (await f.workerPool.query<{ v: { erased: number; deleted: number; failed: number } }>("select public.connect_retention_sweep($1) as v", [limit])).rows[0].v;
const health = async () => (await f.workerPool.query<{ v: { lastSuccessAt: string | null; lastStatus: string | null; overdue: boolean; failedSinceSuccess: boolean } }>("select public.connect_retention_health() as v")).rows[0].v;
const exists = async (id: string) => (await f.admin.query("select count(*)::int n from campaign_responses where id = $1", [id])).rows[0].n === 1;

beforeAll(async () => {
  f = await testDatabase();
  wide = new Pool({ connectionString: f.workerURL, max: 4 });
  await f.db.insert(users).values(["r-a", "r-b"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenantA = (await createWorkspace(f.db, "r-a", "Retention A")).tenantId;
  tenantB = (await createWorkspace(f.db, "r-b", "Retention B")).tenantId;
  const campaign = { name: "Synthetic crusade", type: "evangelistic_crusade" };
  campaignA = (await createCampaign(f.db, "r-a", tenantA, campaign, "ret-a")).id;
  campaignB = (await createCampaign(f.db, "r-b", tenantB, campaign, "ret-b")).id;
  noticeA = await notice("r-a", tenantA, "Synthetic notice A (test fixture)");
  noticeB = await notice("r-b", tenantB, "Synthetic notice B (test fixture)");
  formA = await newForm("r-a", tenantA);
  versionA = await draft("r-a", tenantA, formA, 1, 30, noticeA); await publish("r-a", tenantA, versionA);
  const formB = await newForm("r-b", tenantB);
  versionB = await draft("r-b", tenantB, formB, 1, 30, noticeB); await publish("r-b", tenantB, versionB);
  linkA = await link("r-a", tenantA, campaignA, versionA);
  linkB = await link("r-b", tenantB, campaignB, versionB);
});
afterAll(async () => { await wide?.end(); await f?.close(); });
beforeEach(async () => {
  // Tombstones from an earlier test are removed the way the sweep would (aged, then deleted under its setting) so each test starts clean.
  await f.admin.query("select set_config('app.connect_retention', 'on', false)");
  await f.admin.query("update campaign_responses set erased_at = date_trunc('day', now() - interval '200 days') where status = 'erased'");
  await f.admin.query("delete from campaign_response_consents where response_id in (select id from campaign_responses where status = 'erased')");
  await f.admin.query("delete from campaign_responses where status = 'erased'");
  await f.admin.query("select set_config('app.connect_retention', '', false)");
  await f.admin.query("delete from connect_retention_runs");
});

describe("policy", () => {
  it("is the same in SQL and TypeScript, and the small-group helper matches", async () => {
    const [p] = (await f.db.execute<{ max_pending_days: number; tombstone_days: number; small_group_min: number; health_window_hours: number }>(sql`select * from public.connect_retention_policy()`)).rows;
    expect(p).toEqual({ max_pending_days: CONNECT_RETENTION_POLICY.maxPendingDays, tombstone_days: CONNECT_RETENTION_POLICY.tombstoneDays,
      small_group_min: CONNECT_RETENTION_POLICY.smallGroupMin, health_window_hours: CONNECT_RETENTION_POLICY.healthWindowHours });
    for (const n of [0, 1, 4, 5, 6, 100, -1]) {
      const [row] = (await f.db.execute<{ v: number | null }>(sql`select public.connect_suppress_small(${n}) as v`)).rows;
      expect(row.v, `count ${n}`).toBe(suppressSmall(n));
    }
    expect((await f.db.execute<{ v: number | null }>(sql`select public.connect_suppress_small(null) as v`)).rows[0].v).toBeNull();
  });
});

describe("maximum retention", () => {
  it("refuses a form version above the maximum, on insert and on change, and allows shorter", async () => {
    await expect(draft("r-a", tenantA, formA, 2, 31, noticeA)).rejects.toThrow();
    const ok = await draft("r-a", tenantA, formA, 3, 30, noticeA);
    const short = await draft("r-a", tenantA, formA, 4, 1, noticeA);
    expect(ok && short).toBeTruthy();
    await expect(as("r-a", tenantA, (tx) => tx.execute(sql`update form_versions set pending_retention_days = 31 where tenant_id = ${tenantA} and id = ${short}`))).rejects.toThrow();
    await as("r-a", tenantA, (tx) => tx.execute(sql`update form_versions set pending_retention_days = 20 where tenant_id = ${tenantA} and id = ${short}`));
  });
  it("leaves an already published longer version untouched when something else changes", async () => {
    await f.admin.query("alter table form_versions disable trigger form_version_retention_max");
    const legacy = await draft("r-a", tenantA, formA, 5, 90, noticeA);
    await f.admin.query("alter table form_versions enable trigger form_version_retention_max");
    await publish("r-a", tenantA, legacy);
    expect((await f.admin.query("select status, pending_retention_days from form_versions where id = $1", [legacy])).rows[0]).toEqual({ status: "published", pending_retention_days: 90 });
  });
});

describe("the sweep", () => {
  it("erases expired responses in every ministry, leaves unexpired ones, and keeps fresh tombstones", async () => {
    const [oldA, oldB, freshA] = [await seed(a(), "Expired A"), await seed(b(), "Expired B"), await seed(a(), "Not yet")];
    await expire(oldA); await expire(oldB);
    expect(await sweep()).toEqual({ erased: 2, deleted: 0, failed: 0 });
    const gone = (await f.admin.query("select status, preferred_name, erased_at, expires_at from campaign_responses where status = 'erased' and tenant_id = any($1)", [[tenantA, tenantB]])).rows;
    expect(gone).toHaveLength(2);
    for (const row of gone) expect(row).toMatchObject({ status: "erased", preferred_name: null, expires_at: null });
    expect((await f.admin.query("select count(*)::int n from campaign_response_contact_methods where tenant_id = any($1)", [[tenantA, tenantB]])).rows[0].n).toBe(1);
    expect((await f.admin.query("select status from campaign_responses where id = $1", [freshA])).rows[0].status).toBe("pending");
    expect(await sweep()).toEqual({ erased: 0, deleted: 0, failed: 0 });
  });

  it("deletes a tombstone past the tombstone period with its redacted consent rows, and nothing else", async () => {
    const [x, y] = [await seed(a()), await seed(b())];
    await expire(x); await expire(y);
    await sweep();
    const tombs = (await f.admin.query("select id, tenant_id from campaign_responses where status = 'erased' order by tenant_id")).rows;
    expect(tombs).toHaveLength(2);
    const [older, newer] = [tombs.find((t) => t.tenant_id === tenantA)!, tombs.find((t) => t.tenant_id === tenantB)!];
    await ageTombstone(older.id, 91);
    await ageTombstone(newer.id, 89);
    expect(await sweep()).toEqual({ erased: 0, deleted: 1, failed: 0 });
    expect(await exists(older.id)).toBe(false);
    expect((await f.admin.query("select count(*)::int n from campaign_response_consents where response_id = $1", [older.id])).rows[0].n).toBe(0);
    expect(await exists(newer.id)).toBe(true);
    expect((await f.admin.query("select count(*)::int n from campaign_response_consents where response_id = $1", [newer.id])).rows[0].n).toBe(1);
  });

  it("never handles the same row twice when two sweeps run at once, and a repeat finishes the rest", async () => {
    const ids = [];
    for (let i = 0; i < 6; i++) ids.push(await seed(i % 2 ? a() : b()));
    for (const id of ids) await expire(id);
    const one = async () => (await wide.query<{ v: { erased: number; deleted: number } }>("select public.connect_retention_sweep(3) as v")).rows[0].v;
    const [first, second] = await Promise.all([one(), one()]);
    // Both look at the same oldest rows; whoever locks a row first erases it and the other skips it.
    expect(first.erased + second.erased).toBeLessThanOrEqual(6);
    expect(first.erased + second.erased).toBeGreaterThanOrEqual(3);
    let total = first.erased + second.erased;
    for (let i = 0; i < 5 && total < 6; i++) total += (await one()).erased;
    expect(total).toBe(6);
    expect((await f.admin.query("select count(*)::int n from campaign_responses where status = 'erased' and tenant_id = any($1)", [[tenantA, tenantB]])).rows[0].n).toBe(6);
  });
});

describe("deletion stays refused everywhere else", () => {
  it("refuses to delete a tombstone or consent row without the sweep's setting, or before the period", async () => {
    const id = await seed(a()); await expire(id); await sweep();
    const tomb = (await f.admin.query("select id from campaign_responses where status = 'erased' and tenant_id = $1", [tenantA])).rows[0].id;
    await ageTombstone(tomb, 120);
    await expect(f.admin.query("delete from campaign_response_consents where response_id = $1", [tomb])).rejects.toThrow("append-only");
    await expect(f.admin.query("delete from campaign_responses where id = $1", [tomb])).rejects.toThrow("erased, not deleted");
    await f.admin.query("select set_config('app.connect_retention', 'on', false)");
    await ageTombstone(tomb, 30);
    await expect(f.admin.query("delete from campaign_response_consents where response_id = $1", [tomb])).rejects.toThrow("append-only");
    await expect(f.admin.query("delete from campaign_responses where id = $1", [tomb])).rejects.toThrow("erased, not deleted");
    const fresh = await seed(a());
    await expect(f.admin.query("delete from campaign_responses where id = $1", [fresh])).rejects.toThrow("erased, not deleted");
    await expect(f.admin.query("delete from campaign_response_consents where response_id = $1", [fresh])).rejects.toThrow("append-only");
  });
  it("refuses the application role even with the sweep's setting on and a tombstone past the period", async () => {
    const id = await seed(a()); await expire(id); await sweep();
    const tomb = (await f.admin.query("select id from campaign_responses where status = 'erased' and tenant_id = $1", [tenantA])).rows[0].id;
    await ageTombstone(tomb, 120);
    for (const statement of [sql`delete from campaign_response_consents where response_id = ${tomb}::uuid`, sql`delete from campaign_responses where id = ${tomb}::uuid`]) {
      await expect(f.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.connect_retention', 'on', true), set_config('app.tenant_id', ${tenantA}, true)`);
        await tx.execute(statement);
      })).rejects.toThrow();
    }
    expect(await exists(tomb)).toBe(true);
  });
  it("skips a row it cannot handle, keeps going, and records the run as failed", async () => {
    const [x, y] = [await seed(a()), await seed(b())];
    await expire(x); await expire(y); await sweep();
    const tombs = (await f.admin.query("select id, tenant_id from campaign_responses where status = 'erased'")).rows;
    for (const t of tombs) await ageTombstone(t.id, 120);
    const stuck = tombs.find((t) => t.tenant_id === tenantA)!;
    // An unexpected child row the sweep does not know about blocks deleting this one tombstone (foreign key).
    await f.admin.query("alter table connect_intake_events disable trigger intake_event_guard");
    await f.admin.query("insert into connect_intake_events (tenant_id, response_id, event, actor, created_at) values ($1, $2, 'purge', 'worker', date_trunc('day', now()))", [stuck.tenant_id, stuck.id]);
    await f.admin.query("alter table connect_intake_events enable trigger intake_event_guard");
    expect(await sweep()).toEqual({ erased: 0, deleted: 1, failed: 1 });
    expect(await exists(stuck.id)).toBe(true);
    expect((await f.admin.query("select status, error_code, tombstones_deleted from connect_retention_runs order by finished_at desc limit 1")).rows[0])
      .toEqual({ status: "failed", error_code: "row_failed", tombstones_deleted: 1 });
    expect(await health()).toMatchObject({ failedSinceSuccess: true, lastStatus: "failed" });
    await f.admin.query("alter table connect_intake_events disable trigger intake_event_guard");
    await f.admin.query("delete from connect_intake_events where response_id = $1", [stuck.id]);
    await f.admin.query("alter table connect_intake_events enable trigger intake_event_guard");
    expect(await sweep()).toEqual({ erased: 0, deleted: 1, failed: 0 });
  });
  it("gives the application role no way to delete responses, consents or read the run log", async () => {
    await expect(f.db.execute(sql`delete from campaign_responses`)).rejects.toThrow();
    await expect(f.db.execute(sql`delete from campaign_response_consents`)).rejects.toThrow();
    await expect(f.db.execute(sql`select * from connect_retention_runs`)).rejects.toThrow();
    await expect(f.db.execute(sql`insert into connect_retention_runs (started_at, status) values (now(), 'ok')`)).rejects.toThrow();
  });
});

describe("run log and health", () => {
  it("is overdue before any run, healthy after one, failed after a recorded failure, and overdue again when stale", async () => {
    expect(await health()).toMatchObject({ lastSuccessAt: null, lastStatus: null, overdue: true, failedSinceSuccess: false });
    await sweep();
    expect(await health()).toMatchObject({ lastStatus: "ok", overdue: false, failedSinceSuccess: false });
    await f.workerPool.query("select public.connect_retention_record_failure('sweep_failed')");
    expect(await health()).toMatchObject({ lastStatus: "failed", overdue: false, failedSinceSuccess: true });
    await f.workerPool.query("select public.connect_retention_record_failure('has spaces and secrets@example.test')");
    expect((await f.admin.query("select error_code from connect_retention_runs where status = 'failed' order by finished_at desc limit 1")).rows[0].error_code).toBe("sweep_failed");
    await sweep();
    await f.admin.query("update connect_retention_runs set finished_at = now() - interval '27 hours'");
    expect(await health()).toMatchObject({ overdue: true });
  });
  it("keeps the run log for 90 days", async () => {
    await f.admin.query("insert into connect_retention_runs (started_at, finished_at, status) values (now() - interval '100 days', now() - interval '100 days', 'ok')");
    await sweep();
    expect((await f.admin.query("select count(*)::int n from connect_retention_runs where finished_at < now() - interval '90 days'")).rows[0].n).toBe(0);
  });
  it("records counts only: no ministry, response or person", async () => {
    const id = await seed(a(), "Private Name"); await expire(id); await sweep();
    const { rows: [run] } = await f.admin.query("select * from connect_retention_runs");
    expect(Object.keys(run).sort()).toEqual(["error_code", "finished_at", "id", "responses_erased", "started_at", "status", "tombstones_deleted"]);
    expect(run).toMatchObject({ status: "ok", responses_erased: 1, tombstones_deleted: 0, error_code: null });
    expect(JSON.stringify(run)).not.toMatch(/Private|guest@|example\.test/);
  });
});
