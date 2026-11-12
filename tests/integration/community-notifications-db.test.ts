import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";

// C15a (migration 0041): in-app notifications, preferences, announcements, grouping and retention.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string, other: string, general: string, news: string;
const people = ["n-owner", "n-mod", "n-one", "n-two", "n-three", "n-b-owner", "n-b-member"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
type Out = { outcome: string; id: string | null };
type Item = { id: string; kind: string; count: number; read: boolean; actorName: string | null; postId: string | null; detail: Record<string, unknown> };
const call = (user: string, statement: ReturnType<typeof sql>) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: Out }>(statement)).rows[0].v);
const post = (user: string, text = "Hello", category = general, id: string | null = null) =>
  call(user, sql`select public.community_post_save('nt-club', ${id}::uuid, ${category}::uuid, 'A post', ${JSON.stringify(body(text))}::jsonb, ${text}, null, null, '{}'::uuid[], false, false) as v`);
const reply = (user: string, postId: string, text: string) => call(user, sql`select public.community_comment_save('nt-club', ${postId}::uuid, null, ${text}) as v`);
const like = (user: string, type: string, id: string) => call(user, sql`select public.community_like_toggle('nt-club', ${type}, ${id}::uuid) as v`);
const list = async (user: string, slug = "nt-club") => withUser(f.db, user, async (tx) => (await tx.execute<{ v: { outcome: string; unread: number; items: Item[] } }>(sql`select public.community_notifications_list(${slug}, 30) as v`)).rows[0].v);
const kinds = async (user: string) => (await list(user)).items.filter((i) => i.kind !== "announcement").map((i) => i.kind).sort();
const markAll = (user: string) => call(user, sql`select public.community_notifications_read('nt-club', null) as v`);
const prefs = (user: string, replies: boolean, likes: boolean, announcements: boolean, muted: boolean) =>
  call(user, sql`select public.community_notification_prefs_save('nt-club', ${replies}, ${likes}, ${announcements}, ${muted}) as v`);
const stored = async (user: string) => (await f.admin.query("select kind, actor_count, read_at from community_notifications where recipient_id = $1 and community_id = $2 order by created_at", [user, club])).rows;

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "n-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "n-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "n-owner", a, { name: "NT club", slug: "nt-club" })).id;
  other = (await createCommunity(f.db, "n-b-owner", b, { name: "Other NT club", slug: "other-nt-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = any($1)", [[club, other]]);
  const member = async (user: string, community: string, tenant: string, role: string) => {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, 'active', now() - interval '1 hour')", [tenant, community, user, role]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [tenant, user, community]);
  };
  await member("n-mod", club, a, "moderator");
  for (const user of ["n-one", "n-two", "n-three"]) await member(user, club, a, "member");
  await member("n-b-member", other, b, "member");
  general = (await f.admin.query("select id from community_categories where community_id = $1 and name = 'General'", [club])).rows[0].id;
  news = (await f.admin.query("insert into community_categories (tenant_id, community_id, name, position, hosts_only) values ($1, $2, 'News', 1, true) returning id", [a, club])).rows[0].id;
});
afterAll(async () => { await f?.close(); });

it("notifies the post author and earlier repliers about a reply, never the replier, and groups likes", async () => {
  const p = await post("n-one", "Question");
  expect((await reply("n-one", p.id!, "my own reply")).outcome).toBe("ok");
  expect(await stored("n-one")).toHaveLength(0);
  expect((await reply("n-two", p.id!, "first")).outcome).toBe("ok");
  expect(await kinds("n-one")).toEqual(["reply"]);
  expect(await kinds("n-two")).toEqual([]);
  expect((await reply("n-three", p.id!, "second")).outcome).toBe("ok");
  expect(await kinds("n-two")).toEqual(["thread_reply"]);
  expect(await kinds("n-one")).toEqual(["reply", "reply"]);
  expect(await kinds("n-three")).toEqual([]);
  // Likes: grouped per target; unliking adds nothing; the author is never told about their own like.
  expect((await like("n-two", "post", p.id!)).outcome).toBe("liked");
  expect((await like("n-three", "post", p.id!)).outcome).toBe("liked");
  expect((await like("n-two", "post", p.id!)).outcome).toBe("unliked");
  expect((await like("n-one", "post", p.id!)).outcome).toBe("liked");
  const likes = (await stored("n-one")).filter((r) => r.kind === "like");
  expect(likes).toHaveLength(1);
  expect(likes[0].actor_count).toBe(2);
  // Reading starts a new group.
  expect((await markAll("n-one")).outcome).toBe("ok");
  const comment = (await f.admin.query("select id from community_comments where post_id = $1 and author_id = 'n-two'", [p.id])).rows[0].id;
  expect((await like("n-three", "comment", comment)).outcome).toBe("liked");
  expect(await kinds("n-two")).toEqual(["like", "thread_reply"]);
  await like("n-one", "post", p.id!); // unlike, then like again below to open a fresh group
  await like("n-one", "post", p.id!);
  expect((await stored("n-one")).filter((r) => r.kind === "like" && r.read_at === null)).toHaveLength(0);
  expect((await like("n-two", "post", p.id!)).outcome).toBe("liked");
  expect((await stored("n-one")).filter((r) => r.kind === "like" && r.read_at === null)).toHaveLength(1);
});

it("honours the reply and like switches and muting the community", async () => {
  const p = await post("n-three", "Switches");
  expect((await prefs("n-three", false, true, true, false)).outcome).toBe("ok");
  await reply("n-one", p.id!, "no ping");
  expect(await kinds("n-three")).toEqual([]);
  await like("n-one", "post", p.id!);
  expect(await kinds("n-three")).toEqual(["like"]);
  expect((await prefs("n-three", true, false, true, false)).outcome).toBe("ok");
  await like("n-two", "post", p.id!);
  expect((await stored("n-three"))[0].actor_count).toBe(1);
  expect((await prefs("n-three", true, true, true, true)).outcome).toBe("ok");
  await reply("n-two", p.id!, "muted");
  expect(await kinds("n-three")).toEqual(["like"]);
  expect((await prefs("n-three", true, true, true, false)).outcome).toBe("ok");
  expect((await call("n-b-member", sql`select public.community_notification_prefs_save('nt-club', true, true, true, false) as v`)).outcome).toBe("not_found");
});

it("lists announcements from hosts-only categories and pinned posts after the last seen time, once", async () => {
  const before = (await list("n-two")).items.filter((i) => i.kind === "announcement").length;
  const n = await post("n-owner", "News", news);
  const pinned = await post("n-owner", "Pinned", general);
  expect((await call("n-owner", sql`select public.community_moderate('nt-club', 'pin', ${pinned.id}::uuid) as v`)).outcome).toBe("ok");
  await post("n-owner", "Ordinary", general);
  const view = await list("n-two");
  const announcements = view.items.filter((i) => i.kind === "announcement");
  expect(announcements.map((i) => i.postId).sort()).toEqual([n.id, pinned.id].sort());
  expect(announcements.length - before).toBe(2);
  expect(view.unread).toBeGreaterThanOrEqual(2);
  // The author does not see their own announcement; opening the bell (empty list) marks announcements seen.
  expect((await list("n-owner")).items.filter((i) => i.kind === "announcement")).toHaveLength(0);
  expect((await call("n-two", sql`select public.community_notifications_read('nt-club', '{}'::uuid[]) as v`)).outcome).toBe("ok");
  expect((await list("n-two")).items.filter((i) => i.kind === "announcement")).toHaveLength(0);
  // Switch off: nothing.
  await post("n-owner", "More news", news);
  expect((await prefs("n-one", true, true, false, false)).outcome).toBe("ok");
  expect((await list("n-one")).items.filter((i) => i.kind === "announcement")).toHaveLength(0);
  expect((await prefs("n-one", true, true, true, false)).outcome).toBe("ok");
  expect((await list("n-one")).items.filter((i) => i.kind === "announcement").length).toBeGreaterThan(0);
});

it("tells hosts about reports, held items and appeals (grouped), and members about warnings and decisions", async () => {
  const p = await post("n-one", "Reportable");
  expect((await call("n-two", sql`select public.community_report('nt-club', 'post', ${p.id}, 'spam', null) as v`)).outcome).toBe("ok");
  const owner = (await list("n-owner")).items.filter((i) => i.kind === "host_queue");
  expect(owner).toHaveLength(1);
  expect((await list("n-mod")).items.filter((i) => i.kind === "host_queue")).toHaveLength(1);
  await f.admin.query("update communities set banned_words = ARRAY['casino'] where id = $1", [club]);
  const held = await post("n-three", "casino night");
  expect(held.outcome).toBe("held");
  const queue = (await list("n-owner")).items.filter((i) => i.kind === "host_queue");
  expect(queue).toHaveLength(1);
  expect(queue[0].count).toBe(2);
  expect(await kinds("n-three")).not.toContain("host_queue");
  expect((await call("n-mod", sql`select public.community_held_decide('nt-club', 'post', ${held.id}::uuid, 'approve') as v`)).outcome).toBe("ok");
  expect((await list("n-three")).items.find((i) => i.kind === "held_decision")).toMatchObject({ detail: { decision: "approve" }, postId: held.id });
  const bad = await post("n-three", "casino again");
  expect((await call("n-owner", sql`select public.community_held_decide('nt-club', 'post', ${bad.id}::uuid, 'reject') as v`)).outcome).toBe("ok");
  expect((await list("n-three")).items.filter((i) => i.kind === "held_decision")).toHaveLength(2);
  await f.admin.query("update communities set banned_words = '{}' where id = $1", [club]);
  expect((await call("n-mod", sql`select public.community_warn('nt-club', 'n-two', 'Be kind') as v`)).outcome).toBe("ok");
  expect(await kinds("n-two")).toContain("warning");
  // Appeals: hosts are told; the decision reaches the appellant even though they read nothing now.
  expect((await call("n-owner", sql`select public.community_member_moderate('nt-club', 'n-two', 'ban', null) as v`)).outcome).toBe("ok");
  expect((await list("n-two")).outcome).toBe("not_found");
  const sent = await call("n-two", sql`select public.community_appeal_submit('nt-club', 'Sorry') as v`);
  expect(sent.outcome).toBe("ok");
  expect((await stored("n-mod")).filter((r) => r.kind === "host_queue" && r.read_at === null)).toHaveLength(1);
  expect((await call("n-owner", sql`select public.community_appeal_decide('nt-club', ${sent.id}::uuid, 'decline', 'No') as v`)).outcome).toBe("ok");
  expect((await stored("n-two")).map((r) => r.kind)).toContain("appeal_decision");
  // Banned and left members receive nothing else.
  const before = (await stored("n-two")).length;
  await post("n-one", "after ban");
  await reply("n-owner", (await post("n-owner", "Thread")).id!, "x");
  expect((await stored("n-two")).length).toBe(before);
});

it("keeps notifications private to the recipient and out of other ministries", async () => {
  const own = await withUser(f.db, "n-one", async (tx) => (await tx.execute<{ recipient_id: string }>(sql`select recipient_id from community_notifications`)).rows);
  expect(own.length).toBeGreaterThan(0);
  expect(new Set(own.map((r) => r.recipient_id))).toEqual(new Set(["n-one"]));
  expect(await withUser(f.db, "n-b-member", async (tx) => (await tx.execute(sql`select 1 from community_notifications`)).rows)).toHaveLength(0);
  expect(await withUser(f.db, "n-one", async (tx) => { try { await tx.execute(sql`savepoint s`); await tx.execute(sql`update community_notifications set read_at = now()`); return "updated"; } catch { return "denied"; } })).toBe("denied");
  expect((await list("n-b-member")).outcome).toBe("not_found");
  expect((await call("n-b-member", sql`select public.community_notifications_read('nt-club', null) as v`)).outcome).toBe("not_found");
  expect(await withUser(f.db, "n-b-owner", async (tx) => (await tx.execute(sql`select 1 from community_notifications`)).rows)).toHaveLength(0);
});

it("marks selected ids read, dismisses the welcome card once and purges old read notifications", async () => {
  const items = (await list("n-one")).items.filter((i) => i.kind !== "announcement" && !i.read);
  expect(items.length).toBeGreaterThan(1);
  expect((await call("n-one", sql`select public.community_notifications_read('nt-club', ${`{${items[0].id}}`}::uuid[]) as v`)).outcome).toBe("ok");
  const after = (await list("n-one")).items.filter((i) => i.kind !== "announcement");
  expect(after.find((i) => i.id === items[0].id)?.read).toBe(true);
  expect(after.find((i) => i.id === items[1].id)?.read).toBe(false);
  // Another person's ids change nothing.
  expect((await call("n-two", sql`select public.community_notifications_read('nt-club', ${`{${items[1].id}}`}::uuid[]) as v`)).outcome).toBe("not_found");
  expect((await call("n-three", sql`select public.community_notifications_read('nt-club', ${`{${items[1].id}}`}::uuid[]) as v`)).outcome).toBe("ok");
  expect((await list("n-one")).items.find((i) => i.id === items[1].id)?.read).toBe(false);
  expect((await call("n-one", sql`select public.community_welcome_dismiss('nt-club') as v`)).outcome).toBe("ok");
  const first = (await f.admin.query("select welcome_dismissed_at from community_memberships where user_id = 'n-one' and community_id = $1", [club])).rows[0].welcome_dismissed_at;
  expect(first).not.toBeNull();
  await call("n-one", sql`select public.community_welcome_dismiss('nt-club') as v`);
  expect((await f.admin.query("select welcome_dismissed_at from community_memberships where user_id = 'n-one' and community_id = $1", [club])).rows[0].welcome_dismissed_at).toEqual(first);
  expect((await call("n-b-member", sql`select public.community_welcome_dismiss('nt-club') as v`)).outcome).toBe("not_found");
  await markAll("n-one");
  await f.admin.query("update community_notifications set read_at = now() - interval '91 days' where recipient_id = 'n-one' and kind = 'reply'");
  const total = (await f.admin.query("select count(*)::int n from community_notifications where recipient_id = 'n-one'")).rows[0].n;
  const old = (await f.admin.query("select count(*)::int n from community_notifications where recipient_id = 'n-one' and read_at < now() - interval '90 days'")).rows[0].n;
  expect(old).toBeGreaterThan(0);
  const removed = await f.db.transaction(async (tx) => (await tx.execute<{ n: number }>(sql`select public.community_purge_notifications() as n`)).rows[0].n);
  expect(removed).toBeGreaterThanOrEqual(old);
  expect((await f.admin.query("select count(*)::int n from community_notifications where recipient_id = 'n-one'")).rows[0].n).toBe(total - old);
  expect(await f.db.transaction(async (tx) => (await tx.execute<{ n: number }>(sql`select public.community_purge_notifications() as n`)).rows[0].n)).toBe(0);
});

it("lets the staff path insert only application notifications for their own ministry", async () => {
  const insert = (tenant: string, kind: string) => f.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenant}, true)`);
    await tx.execute(sql`insert into community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, actor_id) values (${tenant}::uuid, ${club}::uuid, 'n-three', ${kind}, 'application', 'x', 'n-owner')`);
  }).then(() => "ok", () => "denied");
  expect(await insert(a, "application")).toBe("ok");
  expect(await insert(a, "warning")).toBe("denied");
  expect(await insert(b, "application")).toBe("denied");
});
