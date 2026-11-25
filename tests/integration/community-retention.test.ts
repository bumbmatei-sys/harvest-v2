import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { leaveCommunity } from "../../src/server/community-joining";
import { countCommunityEvent, defaultAcquisitionDeps, isLikelyBot } from "../../src/server/community-acquisition";
import { getCommunityStats } from "../../src/server/community-stats";
import { withTenant } from "../../src/server/tenancy";

const slug = "retention-circle", hiddenSlug = "retention-hidden";
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, cid: string, ret: string, tiny: string;
const people = ["rt-owner", "rt-admin", "rt-member", "rt-other", ...Array.from({ length: 18 }, (_, i) => `rt-m${i}`), ...Array.from({ length: 16 }, (_, i) => `rt-c${i}`)];
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const now = new Date("2026-11-25T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const human = new Headers({ "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" });
const enabled = { enabled: true };
const stats = (community: string, period = "last90", user = "rt-owner") => getCommunityStats(f.db, user, a, community, period, now);
async function publish(owner: string, tenant: string, id: string) {
  const v = (await getCommunity(f.db, owner, tenant, id)).version;
  await updateCommunity(f.db, owner, tenant, id, { version: v, allowOpen: true, visibility: "listed", rulesList: ["Be kind."], description: "Weekly study." });
  await publishCommunity(f.db, owner, tenant, id, { version: (await getCommunity(f.db, owner, tenant, id)).version, published: true });
}
const member = (community: string, user: string, status = "active", joined = days(40), role = "member") =>
  q("insert into community_memberships(tenant_id,community_id,user_id,status,role,joined_at) values ($1,$2,$3,$4,$5,$6) on conflict (tenant_id,community_id,user_id) do update set status=excluded.status, joined_at=excluded.joined_at", [a, community, user, status, role, status === "pending" ? null : joined]);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "rt-owner", "Retention Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "rt-other", "Other", "church")).tenantId;
  await putMember(f.db, "rt-owner", a, "rt-admin@example.test", "admin");
  await putMember(f.db, "rt-owner", a, "rt-member@example.test", "member");
  cid = (await createCommunity(f.db, "rt-owner", a, { name: "Retention circle", slug })).id;
  await publish("rt-owner", a, cid);
  const hidden = (await createCommunity(f.db, "rt-owner", a, { name: "Hidden", slug: hiddenSlug })).id;
  await updateCommunity(f.db, "rt-owner", a, hidden, { version: (await getCommunity(f.db, "rt-owner", a, hidden)).version, visibility: "hidden" });
  ret = (await createCommunity(f.db, "rt-owner", a, { name: "Cohort", slug: "retention-cohort" })).id;
  tiny = (await createCommunity(f.db, "rt-owner", a, { name: "Tiny", slug: "retention-tiny" })).id;
  await q("delete from community_memberships where user_id='rt-owner'");
}, 60_000);
afterAll(async () => { await f?.close(); });

it("forces row security on the new tables and keeps writes out of the application role", async () => {
  const rls = await q("select relrowsecurity, relforcerowsecurity from pg_class where relname in ('community_exits','community_daily_counts')");
  expect(rls.rows).toHaveLength(2); expect(rls.rows.every(r => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
  for (const stmt of [sql`insert into community_exits(tenant_id,community_id,user_id,kind) values (${a},${cid},'rt-m0','left')`, sql`delete from community_exits`, sql`update community_exits set reason='privacy'`,
    sql`insert into community_daily_counts(tenant_id,community_id,day,kind,n) values (${a},${cid},current_date,'visit',1)`, sql`select public.community_exit_record()`])
    await expect(withTenant(f.db, "rt-owner", a, "communities:manage", async tx => { await tx.execute(stmt); })).rejects.toThrow();
  const cols = (await q("select column_name from information_schema.columns where table_name='community_daily_counts'")).rows.map(r => r.column_name).sort();
  expect(cols).toEqual(["community_id", "day", "kind", "n", "tenant_id"]);
});

it("records a voluntary leave with a fixed reason and optional short text, and refuses misuse", async () => {
  await member(cid, "rt-m0"); await member(cid, "rt-m1"); await member(cid, "rt-m2");
  await expect(leaveCommunity(f.db, "rt-m0", slug, { reason: "too_busy" })).resolves.toEqual({ outcome: "left" });
  await expect(leaveCommunity(f.db, "rt-m1", slug, { reason: "other", other: "  Moving to another city  " })).resolves.toEqual({ outcome: "left" });
  await expect(leaveCommunity(f.db, "rt-m2", slug, {})).resolves.toEqual({ outcome: "left" });
  const rows = (await q("select user_id, kind, reason, other_text, joined_at is not null as had_join from community_exits order by user_id")).rows;
  expect(rows).toEqual([{ user_id: "rt-m0", kind: "left", reason: "too_busy", other_text: null, had_join: true }, { user_id: "rt-m1", kind: "left", reason: "other", other_text: "Moving to another city", had_join: true },
    { user_id: "rt-m2", kind: "left", reason: null, other_text: null, had_join: true }]);
  await expect(leaveCommunity(f.db, "rt-m0", slug, { reason: "too_busy" })).rejects.toMatchObject({ status: 404 });
  await expect(leaveCommunity(f.db, "rt-other", slug, {})).rejects.toMatchObject({ status: 404 });
  await expect(leaveCommunity(f.db, "rt-m3", "no-such-circle", {})).rejects.toMatchObject({ status: 404 });
  await member(cid, "rt-m3");
  for (const bad of [{ reason: "bored" }, { other: "text without reason" }, { reason: "too_busy", other: "x" }, { reason: "other", other: "x".repeat(201) }, { reason: "other", other: "   " }, { extra: 1 }])
    await expect(leaveCommunity(f.db, "rt-m3", slug, bad)).rejects.toThrow();
  expect((await q("select status from community_memberships where user_id='rt-m3' and community_id=$1", [cid])).rows[0].status).toBe("active");
  await member(cid, "rt-owner", "active", days(100), "owner");
  await expect(leaveCommunity(f.db, "rt-owner", slug, {})).rejects.toMatchObject({ status: 409 });
  await q("delete from community_memberships where user_id='rt-owner'");
  expect((await q("select count(*)::int n from audit_logs where action='community.leave' and tenant_id=$1", [a])).rows[0].n).toBe(3);
});

it("records host removals and bans from any code path, but not a pending request ending", async () => {
  await member(cid, "rt-m4"); await member(cid, "rt-m5"); await member(cid, "rt-m6", "pending");
  await q("update community_memberships set status='removed' where user_id='rt-m4'");
  await q("update community_memberships set status='banned' where user_id='rt-m5'");
  await q("update community_memberships set status='left' where user_id='rt-m6'");
  const rows = (await q("select user_id, kind, reason from community_exits where user_id in ('rt-m4','rt-m5','rt-m6') order by user_id")).rows;
  expect(rows).toEqual([{ user_id: "rt-m4", kind: "removed", reason: null }, { user_id: "rt-m5", kind: "banned", reason: null }]);
});

it("is readable by owners and admins only and erased with the person", async () => {
  for (const user of ["rt-owner", "rt-admin"]) expect(await withTenant(f.db, user, a, "communities:manage", async tx => (await tx.execute(sql`select count(*)::int n from community_exits`)).rows[0].n)).toBeGreaterThan(0);
  expect(await withTenant(f.db, "rt-other", b, "communities:manage", async tx => (await tx.execute(sql`select count(*)::int n from community_exits`)).rows[0].n)).toBe(0);
  await expect(withTenant(f.db, "rt-member", a, "communities:manage", async tx => { await tx.execute(sql`select 1`); })).rejects.toThrow();
  // No person-erasure flow exists yet: like memberships, the departure record goes with the user row (cascade). A person who left through a host action has no audit row (audit is append-only).
  expect((await q("select count(*)::int n from community_exits where user_id='rt-m4'")).rows[0].n).toBe(1);
  await q("delete from users where id='rt-m4'");
  expect((await q("select count(*)::int n from community_exits where user_id='rt-m4'")).rows[0].n).toBe(0);
  expect((await q("select confdeltype from pg_constraint where conrelid='community_exits'::regclass and confrelid='users'::regclass")).rows[0].confdeltype).toBe("c");
});

it("counts visits and join clicks anonymously, off by default, ignoring bots and non-public communities", async () => {
  expect(defaultAcquisitionDeps().enabled).toBe(false);
  expect(await countCommunityEvent(f.db, slug, "visit", human)).toBe(false);
  expect((await q("select count(*)::int n from community_daily_counts")).rows[0].n).toBe(0);
  expect(await countCommunityEvent(f.db, slug, "visit", human, enabled)).toBe(true);
  expect(await countCommunityEvent(f.db, slug, "visit", human, enabled)).toBe(true);
  expect(await countCommunityEvent(f.db, slug, "join_click", human, enabled)).toBe(true);
  expect((await q("select kind, n from community_daily_counts order by kind")).rows).toEqual([{ kind: "join_click", n: 1 }, { kind: "visit", n: 2 }]);
  for (const agent of ["Googlebot/2.1", "curl/8.0.1", "Mozilla/5.0 HeadlessChrome/120", "facebookexternalhit/1.1", "", "x", "python-requests/2.31 (compatible)"])
    expect(await countCommunityEvent(f.db, slug, "visit", new Headers({ "user-agent": agent }), enabled), agent).toBe(false);
  expect(isLikelyBot(new Headers({ "user-agent": human.get("user-agent")!, purpose: "prefetch" }))).toBe(true);
  expect(isLikelyBot(human)).toBe(false);
  expect(await countCommunityEvent(f.db, slug, "scroll", human, enabled)).toBe(false);
  expect(await countCommunityEvent(f.db, hiddenSlug, "visit", human, enabled)).toBe(false);
  expect(await countCommunityEvent(f.db, "retention-tiny", "visit", human, enabled)).toBe(false);
  expect(await countCommunityEvent(f.db, "../etc", "visit", human, enabled)).toBe(false);
  expect((await q("select sum(n)::int s from community_daily_counts")).rows[0].s).toBe(3);
});

it("reports retention cohorts, cancellations by reason and acquisition with the same suppression", async () => {
  await q("delete from community_exits"); await q("delete from community_daily_counts");
  const ids = Array.from({ length: 16 }, (_, i) => `rt-c${i}`);
  for (const id of ids) await member(ret, id, "active", days(40));
  const exit = (user: string, ago: number, reason: string | null) => q("insert into community_exits(tenant_id,community_id,user_id,kind,joined_at,left_at,reason) values ($1,$2,$3,'left',$4,$5,$6)", [a, ret, user, days(40), days(ago), reason]);
  // 5 left within a week of joining (too busy), 5 left after about three weeks (moved away), 6 stayed.
  for (let i = 0; i < 5; i++) { await exit(ids[i], 37, "too_busy"); await q("update community_memberships set status='left' where user_id=$1 and community_id=$2", [ids[i], ret]); }
  for (let i = 5; i < 10; i++) { await exit(ids[i], 20, "moved_away"); await q("update community_memberships set status='left' where user_id=$1 and community_id=$2", [ids[i], ret]); }
  await q("delete from community_exits where reason is null and kind <> 'left'");
  // The trigger also wrote one row per update above; keep only the explicit ones by deleting the trigger-written duplicates (no reason).
  await q("delete from community_exits where community_id=$1 and reason is null", [ret]);
  const s = await stats(ret, "last90");
  expect(s.retention.cancellations).toBe(10);
  expect(s.retention.byReason).toMatchObject({ too_busy: 5, moved_away: 5, other: 0, none: 0 });
  expect(s.retention.removedByHost).toBe(0);
  expect(s.retention.days["7"]).toEqual({ cohort: 16, retained: 11, lost: 5, percent: 68.8 });
  expect(s.retention.days["30"]).toEqual({ cohort: 16, retained: 6, lost: 10, percent: 37.5 });
  expect(s.retention.days["90"]).toEqual({ cohort: 0, retained: 0, lost: 0, percent: null });
  expect((await stats(ret, "last30")).retention.cancellations).toBe(5);
  // Acquisition: 50 visits and 7 join clicks in the last week.
  for (const [day, kind, n] of [[2, "visit", 40], [5, "visit", 10], [2, "join_click", 7]] as const)
    await q("insert into community_daily_counts(tenant_id,community_id,day,kind,n) values ($1,$2,($3::timestamptz)::date,$4,$5)", [a, ret, days(day), kind, n]);
  const week = await stats(ret, "last7");
  expect(week.acquisition).toEqual({ visits: 50, joinClicks: 7, joinPercentOfVisits: 0 });
  expect(week.unavailable).toEqual(["commerce", "courseProgress", "eventParticipation", "chat"]);
  // A small community publishes none of it.
  for (let i = 0; i < 3; i++) { await member(tiny, `rt-c${i}`, "active", days(40)); await q("insert into community_exits(tenant_id,community_id,user_id,kind,joined_at,left_at,reason) values ($1,$2,$3,'left',$4,$5,'privacy')", [a, tiny, `rt-c${i}`, days(40), days(20)]); }
  await q("insert into community_daily_counts(tenant_id,community_id,day,kind,n) values ($1,$2,($3::timestamptz)::date,'visit',3)", [a, tiny, days(2)]);
  const small = await stats(tiny, "last90");
  expect(small.retention.cancellations).toBeNull();
  expect(small.retention.byReason.privacy).toBeNull();
  expect(small.retention.days["30"]).toEqual({ cohort: null, retained: null, lost: null, percent: null });
  expect((await stats(tiny, "last7")).acquisition.visits).toBeNull();
  expect(JSON.stringify(small)).not.toMatch(/rt-[mc]\d|@example/);
  await expect(stats(ret, "last90", "rt-member")).rejects.toMatchObject({ status: 403 });
});

it("ends the access grant and withdraws open applications when a member leaves, and lets a member leave an archived community", async () => {
  const grant = (community: string, user: string) => q("insert into entitlements(tenant_id,user_id,resource_type,resource_id,source) values ($1,$2,'community',$3,'admin_grant')", [a, user, community]);
  await member(cid, "rt-m16"); await grant(cid, "rt-m16");
  await q("insert into community_applications(tenant_id,community_id,user_id,status,questions_version,rules_version,adult_confirmed_at) values ($1,$2,'rt-m16','pending',1,1,now())", [a, cid]);
  await expect(leaveCommunity(f.db, "rt-m16", slug, { reason: "privacy" })).resolves.toEqual({ outcome: "left" });
  expect((await q("select revoked_at is not null as revoked, revoked_by from entitlements where user_id='rt-m16' and resource_id=$1", [cid])).rows).toEqual([{ revoked: true, revoked_by: "rt-m16" }]);
  expect((await q("select status from community_applications where user_id='rt-m16'")).rows).toEqual([{ status: "withdrawn" }]);
  // Rejoining needs a fresh grant: the old one no longer counts.
  expect((await q("select count(*)::int n from entitlements where user_id='rt-m16' and resource_id=$1 and revoked_at is null", [cid])).rows[0].n).toBe(0);
  // Any non-deleted community: an archived one can be left too.
  await q("update communities set status='archived' where id=$1", [ret]);
  const archivedSlug = (await q("select slug from communities where id=$1", [ret])).rows[0].slug as string;
  await member(ret, "rt-m17");
  await expect(leaveCommunity(f.db, "rt-m17", archivedSlug, { reason: "too_busy" })).resolves.toEqual({ outcome: "left" });
  expect((await q("select kind, reason from community_exits where user_id='rt-m17' and community_id=$1", [ret])).rows).toEqual([{ kind: "left", reason: "too_busy" }]);
});
