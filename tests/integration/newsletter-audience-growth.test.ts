import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { users } from "../../src/db/schema";
import { createContact, recordConsent } from "../../src/server/contacts";
import { addPeopleToList, audienceOverview, createAudienceList } from "../../src/server/newsletter-audience";
import { newsletterAnalyticsOverview, newsletterCampaignAnalytics } from "../../src/server/newsletter-campaigns/analytics-overview";
import { snapshotNewsletterAudience } from "../../src/server/newsletter-campaigns/maintenance";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";
import { seedAudienceSnapshots, seedCampaign } from "../helpers/newsletter-analytics-seed";

// Audience growth snapshots and the per-campaign outcome-day series. Synthetic data only, in the disposable test database; nothing is sent.
const owner = "gr-owner", admin = "gr-admin", member = "gr-member", viewer = "gr-viewer", other = "gr-other";
const now = new Date();
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const enabled = { NODE_ENV: "test", HARVEST_NEWSLETTER_RETENTION_ENABLED: "1" } as NodeJS.ProcessEnv;
let fixture: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, elsewhere: string, client: PoolClient;
const overview = (user: string, workspace: string, period: 7 | 30 | 90 = 30) => newsletterAnalyticsOverview(fixture.db, user, workspace, period, now);
const snapshotRows = async (ministry: string) => (await client.query("select * from newsletter_audience_snapshots where tenant_id=$1 order by day", [ministry])).rows;

beforeAll(async () => {
  vi.stubEnv("HARVEST_NEWSLETTER_SUPPRESSION_KEYS", JSON.stringify([randomBytes(32).toString("hex")]));
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected_network"));
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, admin, member, viewer, other].map((id) => ({ id, name: id, email: id + "@example.invalid" })));
  tenant = (await createWorkspace(fixture.db, owner, "Growth ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Other ministry", "church")).tenantId;
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'admin'),($1,$3,'member'),($1,$4,'viewer')", [tenant, admin, member, viewer]);
  client = await fixture.admin.connect();
  // Six subscribed people and two withdrawals (do not contact) in the first ministry; nothing in the second.
  const list = await createAudienceList(fixture.db, owner, tenant, { name: "Weekly" });
  const consent = (id: string, status: "granted" | "withdrawn") => recordConsent(fixture.db, owner, tenant, id, { purpose: "newsletter", status, channel: "email", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });
  const subscribed: string[] = [];
  for (let index = 0; index < 6; index++) {
    const person = await createContact(fixture.db, owner, tenant, { name: `Reader ${index}`, email: `reader${index}@example.invalid`, notes: "" });
    await consent(person.id, "granted");
    subscribed.push(person.id);
  }
  expect(Object.values((await addPeopleToList(fixture.db, owner, tenant, list.id, { contactIds: subscribed })).outcomes)).toEqual(Array(6).fill("added"));
  for (let index = 0; index < 2; index++) await consent((await createContact(fixture.db, owner, tenant, { name: `Withdrawn ${index}`, email: `w${index}@example.invalid`, notes: "" })).id, "withdrawn");
}, 90_000);
afterAll(async () => { client?.release(); expect(fetch).not.toHaveBeenCalled(); vi.restoreAllMocks(); vi.unstubAllEnvs(); await fixture?.close(); });

it("is off without the non-production flag and needs the worker login", async () => {
  expect(await snapshotNewsletterAudience(fixture.workerPool, { NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBeNull();
  expect(await snapshotNewsletterAudience(fixture.workerPool, { ...enabled, NODE_ENV: "production" })).toBeNull();
  expect(await snapshotNewsletterAudience(fixture.workerPool, { ...enabled, VERCEL_ENV: "production" })).toBeNull();
  await expect(snapshotNewsletterAudience(fixture.pool, enabled)).rejects.toThrow("WORKER_ROLE_REQUIRED");
  await expect(fixture.pool.query("select public.newsletter_snapshot_audience(10)")).rejects.toHaveProperty("code", "42501");
  await expect(fixture.workerPool.query("select public.newsletter_snapshot_audience(501)")).rejects.toHaveProperty("code", "22023");
  expect(await snapshotRows(tenant)).toEqual([]);
});

it("takes one snapshot per ministry per UTC day, idempotently, matching the Audience status counts", async () => {
  expect(await snapshotNewsletterAudience(fixture.workerPool, enabled, 1)).toEqual({ taken: 2 });
  const [first] = await snapshotRows(tenant);
  const status = (await audienceOverview(fixture.db, owner, tenant)).counts;
  expect(first).toMatchObject({ day: expect.anything(), subscribed: status.subscribed, unsubscribed: status.unsubscribed, suppressed: status.suppressed });
  expect(first).toMatchObject({ subscribed: 6, unsubscribed: 2, suppressed: 0 });
  expect((await snapshotRows(elsewhere))[0]).toMatchObject({ subscribed: 0, unsubscribed: 0, suppressed: 0 });
  // A second run the same day changes nothing, even after the audience changed.
  await recordConsent(fixture.db, owner, tenant, (await createContact(fixture.db, owner, tenant, { name: "Late", email: "late@example.invalid", notes: "" })).id,
    { purpose: "newsletter", status: "withdrawn", channel: "email", noticeVersion: "notice-v1", source: "test", evidence: "Synthetic" });
  expect(await snapshotNewsletterAudience(fixture.workerPool, enabled)).toEqual({ taken: 0 });
  expect(await snapshotRows(tenant)).toEqual([first]);
  // Two runs at once still leave one row.
  await client.query("delete from newsletter_audience_snapshots where tenant_id=$1", [elsewhere]);
  const runs = await Promise.all([fixture.workerPool.query("select public.newsletter_snapshot_audience(50) as taken"), fixture.workerPool.query("select public.newsletter_snapshot_audience(50) as taken")]);
  expect(runs.reduce((sum, run) => sum + run.rows[0].taken, 0)).toBe(1);
  expect(await snapshotRows(elsewhere)).toHaveLength(1);
});

it("stores counts only, never a person", async () => {
  const columns = (await client.query("select column_name from information_schema.columns where table_name='newsletter_audience_snapshots' order by ordinal_position")).rows.map((row) => row.column_name);
  expect(columns).toEqual(["tenant_id", "day", "subscribed", "unsubscribed", "suppressed", "taken_at"]);
  expect(JSON.stringify(await snapshotRows(tenant))).not.toMatch(/@|reader|contact|subscriber_id/i);
});

it("has no table access for the app or worker logins and FORCE row level security", async () => {
  await expect(fixture.pool.query("select * from newsletter_audience_snapshots")).rejects.toHaveProperty("code", "42501");
  await expect(fixture.workerPool.query("select * from newsletter_audience_snapshots")).rejects.toHaveProperty("code", "42501");
  await expect(fixture.workerPool.query("insert into newsletter_audience_snapshots(tenant_id,day,subscribed,unsubscribed,suppressed) values($1,current_date,0,0,0)", [tenant])).rejects.toHaveProperty("code", "42501");
  const { rows: [rls] } = await client.query("select relrowsecurity, relforcerowsecurity from pg_class where relname='newsletter_audience_snapshots'");
  expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  // The reader checks the ministry and capability itself; a direct call for another ministry is refused.
  await expect(fixture.pool.query("select * from public.newsletter_audience_growth($1,current_date,current_date+1)", [tenant])).rejects.toHaveProperty("code", "42501");
  for (const name of ["newsletter_snapshot_audience", "newsletter_audience_growth", "newsletter_outcome_days"]) {
    const { rows: [fn] } = await client.query("select prosecdef, proconfig from pg_proc where proname=$1", [name]);
    expect(fn.prosecdef).toBe(true);
    expect(fn.proconfig).toEqual(["search_path=pg_catalog, pg_temp"]);
  }
});

it("charts growth with net change, hides groups under 5, and shows days before snapshots as no data", async () => {
  await seedAudienceSnapshots(client, tenant, [
    { day: daysAgo(5), subscribed: 2, unsubscribed: 0, suppressed: 0 }, { day: daysAgo(3), subscribed: 5, unsubscribed: 1, suppressed: 0 },
    { day: daysAgo(2), subscribed: 5, unsubscribed: 2, suppressed: 0 }]);
  const week = await overview(owner, tenant, 7);
  expect(week.growth.days).toHaveLength(7);
  expect(week.growth.firstDay).toBe(daysAgo(5));
  expect(week.growth.days.find((day) => day.day === daysAgo(6))?.counts).toBeNull(); // before snapshots began: no data, not zero
  expect(week.growth.days.find((day) => day.day === daysAgo(4))?.counts).toBeNull(); // a missed day is no data too
  expect(week.growth.days.find((day) => day.day === daysAgo(5))?.counts).toEqual({ subscribed: null, unsubscribed: 0, suppressed: 0 });
  expect(week.growth.days.find((day) => day.day === daysAgo(3))?.counts).toEqual({ subscribed: 5, unsubscribed: null, suppressed: 0 });
  expect(week.growth.days.at(-1)?.counts).toEqual({ subscribed: 6, unsubscribed: null, suppressed: 0 });
  // Net change: last snapshot minus first; withheld when either end is a small group.
  expect(week.growth.net).toEqual({ subscribed: null, unsubscribed: null, suppressed: 0 });
  // The other ministry sees only its own row; nothing of the first ministry.
  const theirs = await overview(other, elsewhere, 90);
  expect(theirs.growth.days.filter((day) => day.counts)).toHaveLength(1);
  expect(theirs.growth.net).toBeNull(); // one snapshot is not a change
});

it("gives growth to owners and admins only", async () => {
  expect((await overview(admin, tenant)).growth.firstDay).toBe(daysAgo(5));
  for (const user of [member, viewer, other]) await expect(overview(user, tenant)).rejects.toMatchObject({ status: 404 });
  // Even with the tenant context set by hand, a member's direct call is refused by the function itself.
  const direct = client;
  {
    await direct.query("begin");
    await direct.query("set local role harvest_app");
    await direct.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)", [tenant, member]);
    await expect(direct.query("select * from public.newsletter_audience_growth($1,current_date-7,current_date+1)", [tenant])).rejects.toHaveProperty("code", "42501");
    await direct.query("rollback");
    await direct.query("begin");
    await direct.query("set local role harvest_app");
    await direct.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)", [tenant, owner]);
    const rows = (await direct.query("select * from public.newsletter_audience_growth($1,current_date-7,current_date+1)", [tenant])).rows;
    expect(rows.length).toBeGreaterThan(0);
    // The function clears the flag it set.
    expect((await direct.query("select current_setting('app.nl_send_tenant',true) as value")).rows[0].value).toBe("");
    await direct.query("rollback");
  }
});

it("charts a campaign's outcomes on the day each was recorded", async () => {
  const campaign = await seedCampaign(client, { tenant, user: owner, name: "Outcome letter", days: [{ day: daysAgo(6), accepted: 10, delivered: 8, bounced: 1, unsubscribed: 2 }] });
  await client.query("set session_replication_role = replica");
  try {
    await client.query("update newsletter_deliveries set delivered_at = delivered_at + interval '1 day', bounced_at = bounced_at + interval '2 days', unsubscribed_at = unsubscribed_at + interval '4 days' where campaign_id=$1", [campaign]);
  } finally { await client.query("set session_replication_role = origin"); }
  const report = await newsletterCampaignAnalytics(fixture.db, admin, tenant, campaign, now);
  const on = (n: number) => report.outcomeDays.find((day) => day.day === daysAgo(n))?.counts;
  expect(report.outcomeDays.map((day) => day.day)).toEqual(report.days.map((day) => day.day));
  expect(on(6)).toEqual({ sent: 10, delivered: 0, bounced: 0, complained: 0, unsubscribed: 0 });
  expect(on(5)).toMatchObject({ delivered: 8, bounced: 0 });
  expect(on(4)).toMatchObject({ bounced: 1, delivered: 0 });
  expect(on(2)).toMatchObject({ unsubscribed: 2 });
  // The selection-day series still puts everything on the day of selection.
  expect(report.days.find((day) => day.day === daysAgo(6))?.counts).toMatchObject({ sent: 10, delivered: 8, bounced: 1, unsubscribed: 2 });
  expect(report.outcomesArchived).toBe(false);
  // Records rolled up after 90 days keep only selection-day totals: the report says so instead of placing them.
  await client.query("set session_replication_role = replica");
  try {
    await client.query("insert into newsletter_archived_counts(tenant_id,campaign_id,day,metric,count) values($1,$2,$3,'selected',12),($1,$2,$3,'delivered',12)", [tenant, campaign, daysAgo(120)]);
  } finally { await client.query("set session_replication_role = origin"); }
  const rolled = await newsletterCampaignAnalytics(fixture.db, owner, tenant, campaign, now);
  expect(rolled.outcomesArchived).toBe(true);
  expect(rolled.outcomeDays.find((day) => day.day === daysAgo(5))?.counts?.delivered).toBe(8);
});

it("withholds a small campaign's outcome series and keeps it to owners and admins", async () => {
  const tiny = await seedCampaign(client, { tenant, user: owner, name: "Tiny outcomes", days: [{ day: daysAgo(3), accepted: 3, delivered: 3 }] });
  const report = await newsletterCampaignAnalytics(fixture.db, owner, tenant, tiny, now);
  expect(report.outcomeDays.length).toBeGreaterThan(0);
  expect(report.outcomeDays.every((day) => day.counts === null)).toBe(true);
  for (const user of [member, viewer, other]) await expect(newsletterCampaignAnalytics(fixture.db, user, tenant, tiny, now)).rejects.toMatchObject({ status: 404 });
  await expect(newsletterCampaignAnalytics(fixture.db, other, elsewhere, tiny, now)).rejects.toMatchObject({ status: 404 });
  await expect(fixture.pool.query("select public.newsletter_outcome_days($1,$2,current_date-7,current_date+1)", [tenant, randomUUID()])).rejects.toHaveProperty("code", "42501");
});

it("opens ministries only to the snapshot itself: a hand-set scan flag in a worker session matches no token", async () => {
  expect((await client.query("select count(*)::int as n from newsletter_growth_scans")).rows[0].n).toBe(0); // every run deletes its token
  await expect(fixture.workerPool.query("select * from newsletter_growth_scans")).rejects.toHaveProperty("code", "42501");
  // A stand-in for any other worker definer that reads workspaces as the migration owner.
  await client.query("create function public.test_growth_count_ministries() returns integer language sql security definer set search_path=pg_catalog,pg_temp as $$ select count(*)::int from public.workspaces $$");
  try {
    await client.query(`alter function public.test_growth_count_ministries() owner to ${fixture.migrationOwner}`);
    await client.query("grant execute on function public.test_growth_count_ministries() to harvest_worker");
    const worker = await fixture.workerPool.connect();
    try {
      await worker.query("begin");
      await worker.query("select set_config('app.nl_growth_scan',$1,true), set_config('app.nl_send_worker','on',true)", [randomUUID()]);
      expect((await worker.query("select public.test_growth_count_ministries() as n")).rows[0].n).toBe(0);
      await worker.query("select set_config('app.nl_growth_scan','on',true)");
      expect((await worker.query("select public.test_growth_count_ministries() as n")).rows[0].n).toBe(0);
      await worker.query("rollback");
    } finally { worker.release(); }
  } finally { await client.query("drop function public.test_growth_count_ministries()"); }
});
