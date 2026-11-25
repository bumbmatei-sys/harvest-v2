import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { getCommunityStats } from "../../src/server/community-stats";

let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, big: string, small: string, other: string, category: string;
const people = ["cs-owner", "cs-admin", "cs-member", "cs-viewer", "cs-other", ...Array.from({ length: 13 }, (_, i) => `cs-p${i}`)];
const q = (query: string, values?: unknown[]) => f.admin.query(query, values);
const now = new Date("2026-11-25T12:00:00Z");
const days = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();
const stats = (community = big, period = "last30", user = "cs-owner", tenant = a) => getCommunityStats(f.db, user, tenant, community, period, now);
const post = (community: string, author: string, ago: number, tenant = a) => q("insert into community_posts(id,tenant_id,community_id,category_id,author_id,title,body,body_text,created_at,updated_at) values ($1,$2,$3,$4,$5,'t','{}'::jsonb,'x',$6,$6)", [randomUUID(), tenant, community, category, author, days(ago)]);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map(id => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "cs-owner", "Stats Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "cs-other", "Other Church", "church")).tenantId;
  await putMember(f.db, "cs-owner", a, "cs-admin@example.test", "admin");
  await putMember(f.db, "cs-owner", a, "cs-member@example.test", "member");
  await putMember(f.db, "cs-owner", a, "cs-viewer@example.test", "viewer");
  big = (await createCommunity(f.db, "cs-owner", a, { name: "Big", slug: "stats-big" })).id;
  small = (await createCommunity(f.db, "cs-owner", a, { name: "Small", slug: "stats-small" })).id;
  other = (await createCommunity(f.db, "cs-other", b, { name: "Other", slug: "stats-other" })).id;
  // The creator is added as the first member; take it out so the fixtures below are the only members.
  await q("delete from community_memberships where user_id='cs-owner'");
  category = (await q("select id from community_categories where community_id=$1 limit 1", [big])).rows[0]?.id
    ?? (await q("insert into community_categories(tenant_id,community_id,name,position) values ($1,$2,'General',0) returning id", [a, big])).rows[0].id;
  // 7 members joined in the last 7 days, 5 earlier (40 days ago), 1 pending.
  for (let i = 0; i < 12; i++) await q("insert into community_memberships(tenant_id,community_id,user_id,status,joined_at) values ($1,$2,$3,'active',$4)", [a, big, `cs-p${i}`, days(i < 7 ? 2 : 40)]);
  await q("insert into community_memberships(tenant_id,community_id,user_id,status) values ($1,$2,'cs-p12','pending')", [a, big]);
  // Applications: 10 started and decided within 6 hours: 5 approved, 5 declined.
  for (let i = 0; i < 10; i++) await q(`insert into community_applications(tenant_id,community_id,user_id,status,questions_version,rules_version,adult_confirmed_at,created_at,decided_at,updated_at)
    values ($1,$2,$3,$4,1,1,now(),$5,$6,$6)`, [a, big, `cs-p${i}`, i < 5 ? "approved" : "declined", days(3), new Date(new Date(days(3)).getTime() + 6 * 3_600_000).toISOString()]);
  // Engagement: 7 posts by 6 people in the last 7 days; 5 with no comment older than a day; 2 comments by 2 people.
  for (let i = 0; i < 7; i++) await post(big, `cs-p${i % 6}`, 3);
  const firstPost = (await q("select id from community_posts where community_id=$1 order by id limit 2", [big])).rows;
  for (let i = 0; i < 2; i++) await q("insert into community_comments(tenant_id,community_id,post_id,author_id,body,created_at,updated_at) values ($1,$2,$3,$4,'hi',$5,$5)", [a, big, firstPost[i].id, `cs-p${i + 6}`, days(2)]);
  // Reports: 6 opened last week, 5 resolved after 10 hours, 1 open.
  for (let i = 0; i < 6; i++) await q(`insert into community_reports(tenant_id,community_id,reporter_id,target_type,target_id,reason,status,created_at,decided_at)
    values ($1,$2,$3,'post',$4,'spam',$5,$6,$7)`, [a, big, `cs-p${i}`, randomUUID(), i < 5 ? "actioned" : "open", days(2), i < 5 ? new Date(new Date(days(2)).getTime() + 10 * 3_600_000).toISOString() : null]);
  // The small community has three members, two posts, one application: every figure is withheld.
  for (let i = 0; i < 3; i++) await q("insert into community_memberships(tenant_id,community_id,user_id,status,joined_at) values ($1,$2,$3,'active',$4)", [a, small, `cs-p${i}`, days(1)]);
  const smallCat = (await q("insert into community_categories(tenant_id,community_id,name,position) values ($1,$2,'General',0) returning id", [a, small])).rows[0].id;
  for (let i = 0; i < 2; i++) await q("insert into community_posts(id,tenant_id,community_id,category_id,author_id,title,body,body_text,created_at,updated_at) values ($1,$2,$3,$4,'cs-p0','t','{}'::jsonb,'x',$5,$5)", [randomUUID(), a, small, smallCat, days(1)]);
  await q("insert into community_applications(tenant_id,community_id,user_id,status,questions_version,rules_version,adult_confirmed_at,created_at,updated_at) values ($1,$2,'cs-p0','pending',1,1,now(),$3,$3)", [a, small, days(1)]);
}, 60_000);
afterAll(async () => { await f?.close(); });

it("is for owners and admins only and answers everyone else, and other communities, with a neutral failure", async () => {
  expect((await stats(big, "last30", "cs-admin")).communityId).toBe(big);
  for (const user of ["cs-member", "cs-viewer"]) await expect(stats(big, "last30", user)).rejects.toMatchObject({ status: 403 });
  await expect(stats(big, "last30", "cs-other")).rejects.toMatchObject({ status: 403 });
  await expect(stats(other, "last30", "cs-owner")).rejects.toMatchObject({ status: 404 });
  await expect(stats(big, "last30", "cs-other", b)).rejects.toMatchObject({ status: 404 });
  await expect(stats(randomUUID())).rejects.toMatchObject({ status: 404 });
  await expect(stats(big, "yesterday")).rejects.toMatchObject({ status: 400 });
  await expect(stats("not-a-uuid")).rejects.toMatchObject({ status: 400 });
});

it("reports real figures for a community large enough to publish them", async () => {
  const s = await stats(big, "last7");
  expect(s).toMatchObject({ timeZone: "UTC", minimumGroup: 5, period: "last7" });
  expect(s.members).toEqual({ active: 12, pending: null, joined: 7 });
  expect(s.applications).toEqual({ started: 10, approved: 5, declined: 5, approvalPercent: 50, averageHoursToDecision: 6 });
  expect(s.engagement).toEqual({ posts: 7, comments: null, contributors: 8, unansweredPosts: 5 });
  expect(s.safety).toEqual({ reportsOpened: 6, reportsResolved: 5, averageHoursToResolve: 10, openNow: null });
  expect(s.unavailable).toEqual(["commerce", "courseProgress", "eventParticipation", "chat"]);
});

it("covers longer periods and moves a joined member out of the last 7 days", async () => {
  expect((await stats(big, "last90")).members.joined).toBe(12);
  expect((await stats(big, "last30")).members.joined).toBe(7);
  expect((await stats(big, "thisMonth")).members.joined).toBe(7);
  expect((await stats(big, "lastMonth")).members.joined).toBe(5);
});

it("withholds a whole period when any part of it is a small group", async () => {
  // Two people joined in a region: the period that contains that region publishes nothing for joined, even though the total looks large.
  await q("insert into community_memberships(tenant_id,community_id,user_id,status,joined_at) values ($1,$2,'cs-p12','active',$3) on conflict do nothing", [a, small, days(60)]);
  await q("update community_memberships set joined_at=$3, status='active' where community_id=$1 and user_id=$2", [big, "cs-p12", days(75)]);
  expect((await stats(big, "last90")).members.joined).toBeNull();
  await q("update community_memberships set joined_at=null, status='pending' where community_id=$1 and user_id=$2", [big, "cs-p12"]);
  expect((await stats(big, "last90")).members.joined).toBe(12);
});

it("withholds every small figure and never reports a recorded zero as unavailable", async () => {
  const s = await stats(small, "last30");
  expect(s.members).toEqual({ active: null, pending: 0, joined: null });
  expect(s.applications).toEqual({ started: null, approved: 0, declined: 0, approvalPercent: null, averageHoursToDecision: null });
  expect(s.engagement).toEqual({ posts: null, comments: 0, contributors: null, unansweredPosts: 0 });
  expect(s.safety).toEqual({ reportsOpened: 0, reportsResolved: 0, averageHoursToResolve: null, openNow: 0 });
});

it("returns no person: no names, ids or emails anywhere in the response", async () => {
  const text = JSON.stringify(await stats(big, "last90"));
  expect(text).not.toMatch(/cs-p\d|@example|cs-owner|cs-admin/);
  const keys = (value: unknown): string[] => value && typeof value === "object" ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]) : [];
  expect(keys(await stats(big, "last90")).filter(k => /user|author|member(?!s)|email|name|reporter/i.test(k))).toEqual([]);
});

it("leaves moderator-removed and held posts out of the posts count, contributors and unanswered snapshot", async () => {
  const before = await stats(big, "last7");
  expect(before.engagement).toMatchObject({ posts: 7, contributors: 8, unansweredPosts: 5 });
  const ids = (await q("select id from community_posts where community_id=$1 and not exists (select 1 from community_comments c where c.post_id=community_posts.id) order by id", [big])).rows.map(r => r.id);
  // Remove two unanswered posts and hold one: 4 posts remain visible, so the figure is withheld rather than shown as 4.
  await q("update community_posts set removed_at=now() where id = any($1::uuid[])", [ids.slice(0, 2)]);
  await q("update community_posts set held_at=now(), held_reason='first_post' where id=$1", [ids[2]]);
  const after = await stats(big, "last7");
  expect(after.engagement.posts).toBeNull();
  expect(after.engagement.unansweredPosts).toBeNull();
  await q("update community_posts set held_at=null, held_reason=null where id=$1", [ids[2]]);
  await q("update community_posts set removed_at=null where id = any($1::uuid[])", [ids.slice(0, 2)]);
  expect((await stats(big, "last7")).engagement.posts).toBe(7);
});

it("is read only", async () => {
  const before = (await q("select (select count(*) from community_posts)::int p, (select count(*) from audit_logs)::int a, (select count(*) from community_memberships)::int m")).rows[0];
  await stats(big, "last30");
  expect((await q("select (select count(*) from community_posts)::int p, (select count(*) from audit_logs)::int a, (select count(*) from community_memberships)::int m")).rows[0]).toEqual(before);
});
