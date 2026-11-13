import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";
import { retentionHealth, runRetention, runRetentionJob } from "../../src/server/connect-retention";

// The retention job: loops until nothing is left, records a failure outside the failed statement, reports health.
let f: Awaited<ReturnType<typeof testDatabase>>, tenant: string, campaign: string, link: string, version: string, notice: string;
const rows = <T = Record<string, unknown>>(result: { rows: unknown[] }) => result.rows as T[];
const as = <T>(run: Parameters<typeof withTenant<T>>[4]) => withTenant(f.db, "j-owner", tenant, "workspace:read", run);
const seed = async () => {
  const { rows: [r] } = await f.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, preferred_name, locale)
    values ($1, $2, $3, $4, $5, 'Synthetic Guest', 'en') returning id`, [tenant, campaign, link, version, randomUUID()]);
  await f.admin.query("update campaign_responses set expires_at = now() - interval '1 hour' where id = $1", [r.id]);
};
const pool = () => ({ query: async <R extends Record<string, unknown>>(text: string, values?: unknown[]) => f.pool.query<R>(text, values) });

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values({ id: "j-owner", name: "j-owner", email: "j-owner@example.test" });
  tenant = (await createWorkspace(f.db, "j-owner", "Job ministry")).tenantId;
  campaign = (await createCampaign(f.db, "j-owner", tenant, { name: "Synthetic crusade", type: "evangelistic_crusade" }, "job")).id;
  notice = await as(async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by)
    values (${tenant}, 'connect-response', 1, 'en', 'Synthetic notice (test fixture)', ${"0".repeat(64)}, 'j-owner') returning id`))[0].id);
  const form = await as(async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenant}, 'Synthetic form', 'j-owner') returning id`))[0].id);
  version = await as(async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, definition, created_by)
    values (${tenant}, ${form}, 1, '{newsletter}'::text[], ${notice}, 30, '{"fields":[]}'::jsonb, 'j-owner') returning id`))[0].id);
  await as((tx) => tx.execute(sql`update form_versions set status = 'published', published_by = 'j-owner' where tenant_id = ${tenant} and id = ${version}`));
  link = await as(async (tx) => rows<{ id: string }>(await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, locale, created_by)
    values (${tenant}, ${campaign}, ${version}, ${randomUUID().replace(/-/g, "")}, 'en', 'j-owner') returning id`))[0].id);
  await f.admin.query("update campaign_response_links set status = 'published' where tenant_id = $1 and id = $2", [tenant, link]);
});
afterAll(async () => { await f?.close(); });
beforeEach(async () => { await f.admin.query("delete from connect_retention_runs"); });

it("sweeps in batches until nothing is left", async () => {
  for (let i = 0; i < 5; i++) await seed();
  const result = await runRetention(pool(), { batch: 2 });
  expect(result).toMatchObject({ erased: 5, deleted: 0, failed: 0 });
  expect(result.batches).toBeGreaterThanOrEqual(3);
  expect((await f.admin.query("select count(*)::int n from campaign_responses where status = 'erased'")).rows[0].n).toBeGreaterThanOrEqual(5);
  expect(await runRetention(pool())).toEqual({ erased: 0, deleted: 0, failed: 0, batches: 1 });
});

it("stops at the batch cap instead of running forever", async () => {
  for (let i = 0; i < 3; i++) await seed();
  expect((await runRetention(pool(), { batch: 1, maxBatches: 2 })).batches).toBe(2);
  await runRetention(pool());
});

it("records a failed run outside the failed statement, and health shows it until a run succeeds", async () => {
  expect(await retentionHealth(pool())).toMatchObject({ healthy: false, overdue: true });
  const failing = { query: async <R extends Record<string, unknown>>(text: string, values?: unknown[]) => {
    if (text.includes("connect_retention_sweep")) throw new Error("boom with secret@example.test");
    return f.pool.query<R>(text, values);
  } };
  expect(await runRetentionJob(failing)).toEqual({ ok: false });
  expect(await retentionHealth(pool())).toMatchObject({ healthy: false, failedSinceSuccess: true, lastStatus: "failed" });
  expect((await f.admin.query("select error_code from connect_retention_runs where status = 'failed'")).rows).toEqual([{ error_code: "sweep_failed" }]);
  expect(await runRetentionJob(pool())).toMatchObject({ ok: true });
  expect(await retentionHealth(pool())).toMatchObject({ healthy: true, overdue: false, failedSinceSuccess: false, lastStatus: "ok" });
});
