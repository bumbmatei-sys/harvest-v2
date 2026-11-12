import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";

// C12a (migration 0039): reports, held content, mute/ban, and host-only reads.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string, other: string, general: string;
const people = ["m-owner", "m-admin", "m-mod", "m-one", "m-two", "m-three", "m-new", "m-b-owner", "m-b-member"];
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
type Out = { outcome: string; id: string | null };
const call = (user: string, statement: ReturnType<typeof sql>) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: Out }>(statement)).rows[0].v);
const post = (user: string, text = "Hello", id: string | null = null, slug = "mod-club") =>
  call(user, sql`select public.community_post_save(${slug}, ${id}::uuid, ${general}::uuid, 'A post', ${JSON.stringify(body)}::jsonb, ${text},
    null, null, '{}'::uuid[], false, false) as v`);
const reply = (user: string, postId: string, text = "Amen", id: string | null = null) =>
  call(user, sql`select public.community_comment_save('mod-club', ${postId}::uuid, ${id}::uuid, ${text}) as v`);
const like = (user: string, type: string, id: string) => call(user, sql`select public.community_like_toggle('mod-club', ${type}, ${id}::uuid) as v`);
const report = (user: string, type: string, id: string, reason = "spam", note: string | null = null, slug = "mod-club") =>
  call(user, sql`select public.community_report(${slug}, ${type}, ${id}, ${reason}, ${note}) as v`);
const decide = (user: string, id: string, decision: string) => call(user, sql`select public.community_report_decide('mod-club', ${id}::uuid, ${decision}) as v`);
const held = (user: string, type: string, id: string, decision: string) => call(user, sql`select public.community_held_decide('mod-club', ${type}, ${id}::uuid, ${decision}) as v`);
const moderate = (user: string, target: string, action: string, days: number | null = null) =>
  call(user, sql`select public.community_member_moderate('mod-club', ${target}, ${action}, ${days}::int) as v`);
const read = (user: string, table: string) => withUser(f.db, user, async (tx) => (await tx.execute(sql.raw(`select * from ${table}`))).rows);
const membership = async (user: string) => (await f.admin.query("select role, status, muted_until from community_memberships where community_id = $1 and user_id = $2", [club, user])).rows[0];

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "m-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "m-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "m-owner", a, { name: "Mod club", slug: "mod-club" })).id;
  other = (await createCommunity(f.db, "m-b-owner", b, { name: "Other club", slug: "other-mod-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = any($1)", [[club, other]]);
  const member = async (user: string, community: string, tenant: string, role: string) => {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, 'active', now())", [tenant, community, user, role]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [tenant, user, community]);
  };
  await member("m-admin", club, a, "admin");
  await member("m-mod", club, a, "moderator");
  for (const user of ["m-one", "m-two", "m-three"]) await member(user, club, a, "member");
  await member("m-b-member", other, b, "member");
  general = (await f.admin.query("select id from community_categories where community_id = $1 and name = 'General'", [club])).rows[0].id;
});
afterAll(async () => { await f?.close(); });

it("lets readers report others' posts, replies and members once; hosts read reports, members and ministry B do not", async () => {
  const target = await post("m-one");
  const answer = await reply("m-one", target.id!);
  expect((await report("m-two", "post", target.id!, "spam", "Selling things")).outcome).toBe("ok");
  expect((await report("m-two", "post", target.id!)).outcome).toBe("duplicate");
  expect((await report("m-three", "post", target.id!, "harassment")).outcome).toBe("ok");
  expect((await report("m-two", "comment", answer.id!)).outcome).toBe("ok");
  expect((await report("m-two", "member", "m-one", "other")).outcome).toBe("ok");
  expect((await report("m-one", "post", target.id!)).outcome).toBe("forbidden");
  expect((await report("m-one", "member", "m-one")).outcome).toBe("forbidden");
  expect((await report("m-two", "post", target.id!, "rude")).outcome).toBe("invalid");
  expect((await report("m-two", "member", "m-b-member")).outcome).toBe("not_found");
  expect((await report("m-b-member", "post", target.id!)).outcome).toBe("not_found");
  expect((await report("m-b-member", "post", target.id!, "spam", null, "other-mod-club")).outcome).toBe("not_found");
  for (const user of ["m-mod", "m-admin", "m-owner"]) expect(await read(user, "community_reports")).toHaveLength(4);
  for (const user of ["m-one", "m-two", "m-b-member", "m-b-owner"]) expect(await read(user, "community_reports")).toEqual([]);
  expect(await withTenant(f.db, "m-b-owner", b, "communities:read", async (tx) => (await tx.execute(sql`select id from community_reports`)).rows)).toEqual([]);
  expect(await withTenant(f.db, "m-owner", a, "communities:read", async (tx) => (await tx.execute(sql`select id from community_reports`)).rows)).toHaveLength(4);
  // Nobody writes the table directly.
  await expect(withUser(f.db, "m-mod", (tx) => tx.execute(sql`update community_reports set status = 'dismissed'`))).rejects.toThrow();
  await expect(withTenant(f.db, "m-owner", a, "communities:manage", (tx) => tx.execute(sql`delete from community_reports`))).rejects.toThrow();
});

it("closes every open report on a target when a host keeps or removes it, and records the decision", async () => {
  const target = await post("m-one");
  const first = await report("m-two", "post", target.id!), second = await report("m-three", "post", target.id!);
  expect((await decide("m-one", first.id!, "remove")).outcome).toBe("forbidden");
  expect((await decide("m-mod", first.id!, "remove")).outcome).toBe("ok");
  expect((await f.admin.query("select status from community_reports where id = any($1) order by status", [[first.id, second.id]])).rows.map((r) => r.status)).toEqual(["actioned", "actioned"]);
  expect((await f.admin.query("select removed_by from community_posts where id = $1", [target.id])).rows[0].removed_by).toBe("m-mod");
  expect((await decide("m-mod", second.id!, "keep")).outcome).toBe("not_found");
  const kept = await post("m-one"), r = await report("m-two", "post", kept.id!);
  expect((await decide("m-admin", r.id!, "keep")).outcome).toBe("ok");
  expect((await f.admin.query("select removed_at from community_posts where id = $1", [kept.id])).rows[0].removed_at).toBeNull();
  const member = (await f.admin.query("select id from community_reports where target_type = 'member' and status = 'open'")).rows[0].id;
  expect((await decide("m-mod", member, "remove")).outcome).toBe("invalid");
  const log = (await f.admin.query("select action, subject_user_id, detail from community_moderation_actions order by created_at")).rows;
  expect(log.map((x) => x.action)).toEqual(["report_remove", "report_dismiss"]);
  expect(log[0]).toMatchObject({ subject_user_id: "m-one", detail: { reports: 2 } });
  expect((await read("m-two", "community_moderation_actions"))).toEqual([]);
  expect((await read("m-mod", "community_moderation_actions"))).toHaveLength(2);
});

it("mutes, unmutes, bans and unbans by rank, never the owner or oneself", async () => {
  expect((await moderate("m-one", "m-two", "mute", 1)).outcome).toBe("forbidden");
  expect((await moderate("m-mod", "m-admin", "mute", 1)).outcome).toBe("forbidden");
  expect((await moderate("m-admin", "m-owner", "mute", 1)).outcome).toBe("forbidden");
  expect((await moderate("m-owner", "m-owner", "mute", 1)).outcome).toBe("forbidden");
  expect((await moderate("m-mod", "m-two", "mute", 3)).outcome).toBe("invalid");
  expect((await moderate("m-mod", "m-two", "mute", 7)).outcome).toBe("ok");
  expect((await membership("m-two")).muted_until).not.toBeNull();
  const target = await post("m-one");
  expect((await post("m-two")).outcome).toBe("muted");
  expect((await reply("m-two", target.id!)).outcome).toBe("muted");
  expect((await like("m-two", "post", target.id!)).outcome).toBe("muted");
  expect((await read("m-two", "community_posts")).length).toBeGreaterThan(0);
  expect((await moderate("m-mod", "m-two", "unmute")).outcome).toBe("ok");
  expect((await post("m-two")).outcome).toBe("ok");
  // Ban: role reset, grants revoked, nothing readable; unban by admin/owner leaves them free to rejoin.
  expect((await moderate("m-owner", "m-admin", "ban")).outcome).toBe("ok");
  expect(await membership("m-admin")).toMatchObject({ role: "member", status: "banned" });
  expect((await f.admin.query("select count(*)::int as n from entitlements where user_id = 'm-admin' and revoked_at is null")).rows[0].n).toBe(0);
  expect(await read("m-admin", "community_posts")).toEqual([]);
  expect((await moderate("m-mod", "m-admin", "unban")).outcome).toBe("forbidden");
  expect((await moderate("m-owner", "m-admin", "unban")).outcome).toBe("ok");
  expect((await membership("m-admin")).status).toBe("left");
  expect((await moderate("m-owner", "m-admin", "unban")).outcome).toBe("invalid");
  // Put the admin back for the remaining tests.
  await f.admin.query("update community_memberships set status = 'active', role = 'admin' where user_id = 'm-admin'");
  await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, 'm-admin', 'community', $2, 'admin_grant')", [a, club]);
  const log = (await f.admin.query("select action from community_moderation_actions where target_type = 'member' order by created_at")).rows.map((r) => r.action);
  expect(log).toEqual(["mute", "unmute", "ban", "unban"]);
});

it("holds first posts and banned words for the author and hosts only, and lets hosts approve or reject", async () => {
  await f.admin.query("update communities set hold_first_posts = true, banned_words = ARRAY['casino','buy now'] where id = $1", [club]);
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, 'm-new', 'member', 'active', now())", [a, club]);
  await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, 'm-new', 'community', $2, 'admin_grant')", [a, club]);
  const first = await post("m-new", "Hi everyone");
  expect(first.outcome).toBe("held");
  expect((await f.admin.query("select held_reason from community_posts where id = $1", [first.id])).rows[0].held_reason).toBe("first_post");
  expect((await report("m-two", "post", first.id!)).outcome).toBe("not_found");
  expect((await like("m-two", "post", first.id!)).outcome).toBe("not_found");
  expect((await reply("m-two", first.id!)).outcome).toBe("not_found");
  expect((await post("m-mod", "Hosts are never held")).outcome).toBe("ok");
  // Existing members with published content are not first-posters; banned words still hold.
  const casino = await post("m-one", "Visit the Casino tonight");
  expect(casino.outcome).toBe("held");
  expect((await post("m-one", "casinos are not words on the list")).outcome).toBe("ok");
  const target = await post("m-one", "A clean post");
  const bad = await reply("m-two", target.id!, "Please BUY NOW!");
  expect(bad.outcome).toBe("held");
  // Edits: a banned word holds a published post; a clean edit never releases a held one.
  expect((await post("m-one", "Now with casino", target.id)).outcome).toBe("ok");
  expect((await f.admin.query("select held_reason from community_posts where id = $1", [target.id])).rows[0].held_reason).toBe("banned_word");
  await post("m-one", "Clean again", target.id);
  expect((await f.admin.query("select held_at is not null as held from community_posts where id = $1", [target.id])).rows[0].held).toBe(true);
  expect((await held("m-one", "post", first.id!, "approve")).outcome).toBe("forbidden");
  expect((await held("m-mod", "post", first.id!, "approve")).outcome).toBe("ok");
  expect((await f.admin.query("select held_at from community_posts where id = $1", [first.id])).rows[0].held_at).toBeNull();
  expect((await held("m-mod", "post", first.id!, "approve")).outcome).toBe("not_found");
  expect((await held("m-admin", "comment", bad.id!, "reject")).outcome).toBe("ok");
  expect((await f.admin.query("select removed_by from community_comments where id = $1", [bad.id])).rows[0].removed_by).toBe("m-admin");
  // After approval, the new member is no longer a first-poster.
  expect((await post("m-new", "Second post")).outcome).toBe("ok");
  await f.admin.query("update communities set hold_first_posts = false, banned_words = '{}' where id = $1", [club]);
});

it("matches banned words as whole words in SQL like the shared rule", async () => {
  const match = async (text: string, words: string[]) => (await f.admin.query("select public.community_banned_word_match($1, $2) as m", [text, words])).rows[0].m;
  expect(await match("This is SPAM!", ["spam"])).toBe(true);
  expect(await match("spammer", ["spam"])).toBe(false);
  expect(await match("please buy now today", ["buy now"])).toBe(true);
  expect(await match("a.b", ["a.b"])).toBe(true);
  expect(await match("axb", ["a.b"])).toBe(false);
  expect(await match("anything", [])).toBe(false);
});

it("lists members for hosts only, with banned and muted states", async () => {
  const list = async (user: string) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: { userId: string; status: string } }>(sql`select public.community_moderation_members('mod-club') as v`)).rows.map((r) => r.v));
  expect((await list("m-mod")).map((m) => m.userId)).toContain("m-one");
  expect(await list("m-one")).toEqual([]);
  expect(await list("m-b-member")).toEqual([]);
});
