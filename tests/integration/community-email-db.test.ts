import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";

// C15b (migration 0042): which notification emails are queued, claimed, retried and purged, and who may change email settings.
let f: Awaited<ReturnType<typeof testDatabase>>, wide: Pool, a: string, b: string, club: string, other: string, general: string;
const people = ["e-owner", "e-mod", "e-one", "e-two", "e-three", "e-banned", "e-applicant", "e-outsider", "e-b-owner", "e-b-member"];
type Item = { kind: string; targetType: string; count: number; actorName: string | null; postTitle: string | null; postId: string | null; detail: Record<string, unknown> };
type Job = { id: string; kind: string; to: string; name: string; tenantId: string; communityId: string; recipientId: string; communityName: string; communitySlug: string;
  hasMembership: boolean; items: Item[]; total: number; attempt: number; idempotencyKey: string };
const targets: Record<string, string> = { application: "application", warning: "warning", held_decision: "post", appeal_decision: "appeal", reply: "comment", thread_reply: "comment", like: "post", host_queue: "community" };
const notify = async (user: string, kind: string, over: { community?: string; tenant?: string; post?: string | null; read?: boolean; count?: number; detail?: object; ageDays?: number; actor?: string | null } = {}) =>
  (await f.admin.query(
    `insert into community_notifications (tenant_id, community_id, recipient_id, kind, target_type, target_id, post_id, actor_id, actor_count, detail, read_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, gen_random_uuid()::text, $6, $7, $8, $9, $10, now() - make_interval(days => $11), now() - make_interval(days => $11)) returning id`,
    [over.tenant ?? a, over.community ?? club, user, kind, targets[kind], over.post ?? null, over.actor ?? null, over.count ?? 1, JSON.stringify(over.detail ?? {}), over.read ? new Date() : null, over.ageDays ?? 0])).rows[0].id as string;
const enqueue = async () => (await f.db.execute<{ v: number }>(sql`select public.community_email_enqueue(200) as v`)).rows[0].v;
const claim = async (limit = 50) => (await f.db.execute<{ v: { jobs: Job[] } }>(sql`select public.community_email_claim(${limit}) as v`)).rows[0].v.jobs;
const complete = async (id: string, status: string, error: string | null = null) => (await f.db.execute<{ v: boolean }>(sql`select public.community_email_complete(${id}::uuid, ${status}, ${error}) as v`)).rows[0].v;
const deliveries = async () => (await f.admin.query("select * from community_email_deliveries order by created_at, id")).rows;
const setMember = (user: string, set: string, community = club) => f.admin.query(`update community_memberships set ${set} where user_id = $1 and community_id = $2`, [user, community]);
const prefs = (user: string, frequency: string, slug = "em-club") => withUser(f.db, user, async (tx) => (await tx.execute<{ v: { outcome: string } }>(sql`select public.community_email_prefs_save(${slug}, ${frequency}) as v`)).rows[0].v.outcome);

beforeAll(async () => {
  f = await testDatabase();
  wide = new Pool({ connectionString: f.appURL, max: 4 });
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "e-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "e-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "e-owner", a, { name: "EM club", slug: "em-club" })).id;
  other = (await createCommunity(f.db, "e-b-owner", b, { name: "Other EM club", slug: "other-em-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = any($1)", [[club, other]]);
  const member = async (user: string, community: string, tenant: string, role: string, status = "active") => {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, $5, now() - interval '1 hour')", [tenant, community, user, role, status]);
    if (status === "active") await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [tenant, user, community]);
  };
  await member("e-mod", club, a, "moderator");
  for (const user of ["e-one", "e-two", "e-three"]) await member(user, club, a, "member");
  await member("e-banned", club, a, "member", "banned");
  await member("e-b-member", other, b, "member");
  general = (await f.admin.query("select id from community_categories where community_id = $1 and name = 'General'", [club])).rows[0].id;
});
afterAll(async () => { await wide?.end(); await f?.close(); });
beforeEach(async () => {
  await f.admin.query("delete from community_email_deliveries");
  await f.admin.query("delete from community_notifications");
  await f.admin.query("update community_memberships set email_frequency = 'important', email_digest_cursor = null, notifications_muted = false");
});

it("queues instant email only for a member's own important events, once", async () => {
  await notify("e-one", "warning"); await notify("e-one", "held_decision", { detail: { decision: "approve" } });
  await notify("e-one", "reply"); await notify("e-one", "like", { count: 3 }); await notify("e-mod", "host_queue");
  expect(await enqueue()).toBe(2);
  expect(await enqueue()).toBe(0);
  const jobs = await claim();
  expect(jobs.map((j) => j.kind)).toEqual(["instant", "instant"]);
  expect(jobs.map((j) => j.items[0].kind).sort()).toEqual(["held_decision", "warning"]);
  expect(jobs[0]).toMatchObject({ to: "e-one@example.test", communitySlug: "em-club", communityName: "EM club", hasMembership: true, recipientId: "e-one" });
  expect(await claim()).toEqual([]);
});

it("turning email off stops everything; mute stops warnings and held decisions but not appeal decisions", async () => {
  await setMember("e-one", "email_frequency = 'off'");
  await notify("e-one", "warning"); await notify("e-one", "appeal_decision"); await notify("e-one", "held_decision");
  expect(await enqueue()).toBe(0);
  await setMember("e-two", "notifications_muted = true");
  await notify("e-two", "warning"); await notify("e-two", "held_decision"); await notify("e-two", "appeal_decision", { detail: { decision: "approve" } });
  expect(await enqueue()).toBe(1);
  expect((await claim()).map((j) => j.items[0].kind)).toEqual(["appeal_decision"]);
});

it("still tells a banned appellant and an applicant about their own request, without an unsubscribe link for the applicant", async () => {
  await notify("e-banned", "appeal_decision", { detail: { decision: "decline" } }); await notify("e-banned", "warning");
  await notify("e-applicant", "application", { detail: { status: "approved" } });
  expect(await enqueue()).toBe(2);
  const jobs = await claim();
  const byUser = Object.fromEntries(jobs.map((j) => [j.recipientId, j]));
  expect(byUser["e-banned"].items[0].kind).toBe("appeal_decision");
  expect(byUser["e-applicant"]).toMatchObject({ hasMembership: false, to: "e-applicant@example.test" });
  expect(byUser["e-applicant"].items[0].detail).toEqual({ status: "approved" });
});

it("skips at claim time what no longer applies: already read, or email turned off since", async () => {
  const read = await notify("e-one", "warning"); const off = await notify("e-two", "warning"); await notify("e-three", "warning");
  expect(await enqueue()).toBe(3);
  await f.admin.query("update community_notifications set read_at = now() where id = $1", [read]);
  await setMember("e-two", "email_frequency = 'off'");
  const jobs = await claim();
  expect(jobs.map((j) => j.recipientId)).toEqual(["e-three"]);
  expect((await deliveries()).filter((d) => d.status === "skipped")).toHaveLength(2);
  expect(off).toBeTruthy();
});

it("includes a post title, but not for a removed post", async () => {
  const post = (await f.admin.query("insert into community_posts (tenant_id, community_id, category_id, author_id, title, body, body_text) values ($1, $2, $3, 'e-two', 'A post', '{}'::jsonb, 'x') returning id", [a, club, general])).rows[0].id;
  await notify("e-one", "held_decision", { post, detail: { decision: "approve" } });
  await enqueue();
  expect((await claim())[0].items[0].postTitle).toBe("A post");
  await f.admin.query("delete from community_email_deliveries"); await f.admin.query("update community_posts set removed_at = now() where id = $1", [post]);
  await f.admin.query("delete from community_notifications"); await notify("e-one", "held_decision", { post, detail: { decision: "approve" } });
  await enqueue();
  expect((await claim())[0].items[0].postTitle).toBeNull();
});

it("sends a daily digest of unread non-instant items in its window, then nothing more for that window", async () => {
  expect(await prefs("e-one", "daily")).toBe("ok");
  expect((await f.admin.query("select email_digest_cursor from community_memberships where user_id = 'e-one' and community_id = $1", [club])).rows[0].email_digest_cursor).not.toBeNull();
  await notify("e-one", "reply", { ageDays: 3 });
  expect(await enqueue()).toBe(0);
  await setMember("e-one", "email_digest_cursor = now() - interval '2 days'");
  await notify("e-one", "reply", { ageDays: 1 }); await notify("e-one", "like", { ageDays: 1, count: 2 });
  await notify("e-one", "reply", { ageDays: 1, read: true }); await notify("e-one", "reply", { ageDays: 3 });
  await notify("e-one", "warning", { ageDays: 1 });
  // The warning is an instant email of its own; the digest holds only the unread replies and likes in its window.
  expect(await enqueue()).toBe(2);
  const jobs = await claim();
  expect(jobs.map((j) => j.kind).sort()).toEqual(["digest", "instant"]);
  const digest = jobs.find((j) => j.kind === "digest")!;
  expect(digest.items.map((i) => i.kind).sort()).toEqual(["like", "reply"]);
  expect(digest.total).toBe(2);
  expect((await f.admin.query("select email_digest_cursor > now() - interval '2 minutes' as fresh from community_memberships where user_id = 'e-one' and community_id = $1", [club])).rows[0].fresh).toBe(true);
  expect(await enqueue()).toBe(0);
});

it("moves the cursor but sends nothing for an empty window, ignores weekly members before a week and muted members entirely", async () => {
  await prefs("e-one", "daily"); await setMember("e-one", "email_digest_cursor = now() - interval '2 days'");
  await prefs("e-two", "weekly"); await setMember("e-two", "email_digest_cursor = now() - interval '3 days'");
  await notify("e-two", "reply", { ageDays: 1 });
  await prefs("e-three", "daily"); await setMember("e-three", "email_digest_cursor = now() - interval '2 days', notifications_muted = true");
  await notify("e-three", "reply", { ageDays: 1 });
  expect(await enqueue()).toBe(0);
  const cursors = Object.fromEntries((await f.admin.query("select user_id, email_digest_cursor > now() - interval '2 minutes' as fresh from community_memberships where user_id in ('e-one','e-two','e-three') and community_id = $1", [club])).rows.map((r) => [r.user_id, r.fresh]));
  expect(cursors).toEqual({ "e-one": true, "e-two": false, "e-three": true });
});

it("ends a digest window a minute in the past, so a notification that commits late lands in the next window", async () => {
  await prefs("e-one", "daily"); await setMember("e-one", "email_digest_cursor = now() - interval '2 days'");
  const late = await notify("e-one", "reply");
  expect(await enqueue()).toBe(0);
  const cursor = async () => (await f.admin.query("select extract(epoch from now() - email_digest_cursor)::int as age from community_memberships where user_id = 'e-one' and community_id = $1", [club])).rows[0].age as number;
  expect(await cursor()).toBeGreaterThanOrEqual(55);
  expect(await cursor()).toBeLessThan(120);
  // The next window (a day later in real life) includes it: age the notification and make the cursor due again.
  await f.admin.query("update community_notifications set updated_at = now() - interval '2 minutes' where id = $1", [late]);
  await setMember("e-one", "email_digest_cursor = email_digest_cursor - interval '1 day'");
  expect(await enqueue()).toBe(1);
  expect((await claim())[0].items.map((i) => i.kind)).toEqual(["reply"]);
});

it("re-checks at claim time: muted or banned since queueing gets no warning or digest, but an appeal decision still goes", async () => {
  await notify("e-one", "warning"); await notify("e-two", "warning"); await notify("e-banned", "appeal_decision", { detail: { decision: "decline" } });
  await prefs("e-three", "daily"); await setMember("e-three", "email_digest_cursor = now() - interval '2 days'"); await notify("e-three", "reply", { ageDays: 1 });
  expect(await enqueue()).toBe(4);
  await setMember("e-one", "notifications_muted = true"); await setMember("e-two", "status = 'banned'"); await setMember("e-three", "notifications_muted = true");
  expect((await claim()).map((j) => j.recipientId)).toEqual(["e-banned"]);
  expect((await deliveries()).filter((d) => d.status === "skipped")).toHaveLength(3);
});

it("retries a failed send after its back-off, gives up after 5 attempts, and reclaims an expired lock", async () => {
  await notify("e-one", "warning"); await enqueue();
  let [job] = await claim(); expect(job.attempt).toBe(1);
  expect(await complete(job.id, "failed", "send_failed")).toBe(true);
  expect(await complete(job.id, "failed", "send_failed")).toBe(false);
  expect(await claim()).toEqual([]);
  await f.admin.query("update community_email_deliveries set locked_until = now() - interval '1 minute'");
  [job] = await claim(); expect(job.attempt).toBe(2);
  await f.admin.query("update community_email_deliveries set locked_until = now() - interval '1 minute'");
  [job] = await claim(); expect(job.attempt).toBe(3);
  await f.admin.query("update community_email_deliveries set status = 'failed', attempts = 5, locked_until = now() - interval '1 minute'");
  expect(await claim()).toEqual([]);
  await f.admin.query("update community_email_deliveries set status = 'sending', attempts = 2, locked_until = now() - interval '1 minute'");
  [job] = await claim(); expect(job.attempt).toBe(3);
  expect(await complete(job.id, "sent")).toBe(true);
  const [row] = await deliveries();
  expect(row).toMatchObject({ status: "sent", last_error: null });
  expect(row.sent_at).not.toBeNull();
  expect(await complete(job.id, "sent")).toBe(false);
  expect(await complete(job.id, "bogus")).toBe(false);
  expect(await complete(job.id, "failed", "has spaces and secrets@example.test")).toBe(false);
});

it("never hands the same delivery to two workers", async () => {
  for (let i = 0; i < 6; i++) await notify("e-one", "warning");
  expect(await enqueue()).toBe(6);
  const claimWith = async () => (await wide.query<{ v: { jobs: Job[] } }>("select public.community_email_claim(3) as v")).rows[0].v.jobs;
  const [x, y] = await Promise.all([claimWith(), claimWith()]);
  const ids = [...x, ...y].map((j) => j.id);
  expect(ids).toHaveLength(6);
  expect(new Set(ids).size).toBe(6);
});

it("skips deliveries another worker has locked instead of waiting for them", async () => {
  for (let i = 0; i < 4; i++) await notify("e-one", "warning");
  expect(await enqueue()).toBe(4);
  await f.admin.query("begin");
  try {
    const held = (await f.admin.query("select id from community_email_deliveries order by created_at, id limit 2 for update")).rows.map((r) => r.id as string);
    const claimed = await Promise.race([
      wide.query<{ v: { jobs: Job[] } }>("select public.community_email_claim(10) as v").then((r) => r.rows[0].v.jobs),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("claim waited for a locked row")), 5000))]);
    expect(claimed).toHaveLength(2);
    expect(claimed.some((j) => held.includes(j.id))).toBe(false);
  } finally { await f.admin.query("commit"); }
});

it("keeps ministries apart: each recipient only gets their own community's items", async () => {
  await notify("e-one", "warning"); await notify("e-b-member", "warning", { community: other, tenant: b });
  expect(await enqueue()).toBe(2);
  const jobs = Object.fromEntries((await claim()).map((j) => [j.recipientId, j]));
  expect(jobs["e-one"]).toMatchObject({ communitySlug: "em-club", tenantId: a });
  expect(jobs["e-b-member"]).toMatchObject({ communitySlug: "other-em-club", communityName: "Other EM club", tenantId: b });
});

it("lets only an active reader change their own frequency, and unsubscribe only switches email off", async () => {
  expect(await prefs("e-one", "bogus")).toBe("invalid");
  expect(await prefs("e-outsider", "daily")).toBe("not_found");
  expect(await prefs("e-one", "weekly")).toBe("ok");
  const cursor = async () => (await f.admin.query("select email_digest_cursor c from community_memberships where user_id = 'e-one' and community_id = $1", [club])).rows[0].c as Date | null;
  const first = await cursor(); expect(first).not.toBeNull();
  expect(await prefs("e-one", "daily")).toBe("ok");
  expect((await cursor())!.getTime()).toBe(first!.getTime());
  expect(await prefs("e-one", "important")).toBe("ok");
  expect(await cursor()).toBeNull();
  await prefs("e-one", "daily");
  const call = async (tenant: string, community: string, user: string) => (await f.db.execute<{ v: boolean }>(sql`select public.community_email_unsubscribe(${tenant}::uuid, ${community}::uuid, ${user}) as v`)).rows[0].v;
  expect(await call(b, club, "e-one")).toBe(false);
  expect(await call(a, club, "e-outsider")).toBe(false);
  expect(await call(a, club, "e-one")).toBe(true);
  expect((await f.admin.query("select email_frequency, email_digest_cursor from community_memberships where user_id = 'e-one' and community_id = $1", [club])).rows[0]).toEqual({ email_frequency: "off", email_digest_cursor: null });
  expect((await f.admin.query("select count(*)::int n from audit_logs where action = 'community.email_unsubscribe' and actor_id = 'e-one'")).rows[0].n).toBe(1);
});

it("stores no address or message text in the delivery log, and the application role cannot read or write it directly", async () => {
  await notify("e-one", "warning"); await enqueue();
  const [row] = await deliveries();
  expect(JSON.stringify(row)).not.toMatch(/@|example\.test/);
  await expect(f.db.execute(sql`select * from community_email_deliveries`)).rejects.toThrow();
  await expect(f.db.execute(sql`delete from community_email_deliveries`)).rejects.toThrow();
  await expect(withUser(f.db, "e-one", (tx) => tx.execute(sql`select * from community_email_deliveries`))).rejects.toThrow();
});

it("purges deliveries older than 90 days with the read notifications", async () => {
  await notify("e-one", "warning"); await enqueue();
  await f.admin.query("insert into community_email_deliveries (tenant_id, community_id, recipient_id, kind, notification_id, idempotency_key, created_at, status) values ($1, $2, 'e-two', 'instant', gen_random_uuid(), 'n:old', now() - interval '100 days', 'sent')", [a, club]);
  const removed = (await f.db.execute<{ v: number }>(sql`select public.community_purge_notifications() as v`)).rows[0].v;
  expect(removed).toBe(1);
  expect((await deliveries()).map((d) => d.idempotency_key)).not.toContain("n:old");
  expect(await deliveries()).toHaveLength(1);
});
