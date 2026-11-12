import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";

// C12b (migration 0040): warnings, appeals by banned members, and edit history.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string, other: string, general: string;
const people = ["w-owner", "w-admin", "w-mod", "w-one", "w-two", "w-three", "w-b-owner", "w-b-member"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
type Out = { outcome: string; id: string | null };
const call = (user: string, statement: ReturnType<typeof sql>) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: Out }>(statement)).rows[0].v);
const rows = <T,>(user: string, statement: ReturnType<typeof sql>) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: T }>(statement)).rows.map((r) => r.v));
const post = (user: string, text = "Hello", id: string | null = null, title = "A post") =>
  call(user, sql`select public.community_post_save('wb-club', ${id}::uuid, ${general}::uuid, ${title}, ${JSON.stringify(body(text))}::jsonb, ${text}, null, null, '{}'::uuid[], false, false) as v`);
const reply = (user: string, postId: string, text: string, id: string | null = null) =>
  call(user, sql`select public.community_comment_save('wb-club', ${postId}::uuid, ${id}::uuid, ${text}) as v`);
const warn = (user: string, target: string, reason: string, slug = "wb-club") => call(user, sql`select public.community_warn(${slug}, ${target}, ${reason}) as v`);
const ack = (user: string, id: string, slug = "wb-club") => call(user, sql`select public.community_warning_ack(${slug}, ${id}::uuid) as v`);
const moderate = (user: string, target: string, action: string) => call(user, sql`select public.community_member_moderate('wb-club', ${target}, ${action}, null) as v`);
const appeal = (user: string, message: string, slug = "wb-club") => call(user, sql`select public.community_appeal_submit(${slug}, ${message}) as v`);
const decide = (user: string, id: string, decision: string, text: string | null = null) => call(user, sql`select public.community_appeal_decide('wb-club', ${id}::uuid, ${decision}, ${text}) as v`);
const read = (user: string, table: string) => withUser(f.db, user, async (tx) => (await tx.execute(sql.raw(`select * from ${table}`))).rows);
const membership = async (user: string) => (await f.admin.query("select role, status from community_memberships where community_id = $1 and user_id = $2", [club, user])).rows[0];

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "w-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "w-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "w-owner", a, { name: "WB club", slug: "wb-club" })).id;
  other = (await createCommunity(f.db, "w-b-owner", b, { name: "Other WB club", slug: "other-wb-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = any($1)", [[club, other]]);
  const member = async (user: string, community: string, tenant: string, role: string) => {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, $4, 'active', now())", [tenant, community, user, role]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [tenant, user, community]);
  };
  await member("w-admin", club, a, "admin");
  await member("w-mod", club, a, "moderator");
  for (const user of ["w-one", "w-two", "w-three"]) await member(user, club, a, "member");
  await member("w-b-member", other, b, "member");
  general = (await f.admin.query("select id from community_categories where community_id = $1 and name = 'General'", [club])).rows[0].id;
});
afterAll(async () => { await f?.close(); });

it("lets hosts warn lower ranks with a reason; members acknowledge their own; nobody else reads warnings", async () => {
  expect((await warn("w-one", "w-two", "Be kind")).outcome).toBe("forbidden");
  expect((await warn("w-mod", "w-admin", "Be kind")).outcome).toBe("forbidden");
  expect((await warn("w-admin", "w-owner", "Be kind")).outcome).toBe("forbidden");
  expect((await warn("w-mod", "w-mod", "Be kind")).outcome).toBe("forbidden");
  expect((await warn("w-mod", "w-one", "   ")).outcome).toBe("invalid");
  expect((await warn("w-mod", "w-one", "x".repeat(501))).outcome).toBe("invalid");
  expect((await warn("w-mod", "nobody", "Be kind")).outcome).toBe("not_found");
  expect((await warn("w-b-owner", "w-one", "Be kind")).outcome).toBe("not_found");
  expect((await warn("w-mod", "w-b-member", "Be kind")).outcome).toBe("not_found");
  const first = await warn("w-mod", "w-one", "  Please keep replies kind.  ");
  expect(first.outcome).toBe("ok");
  const second = await warn("w-admin", "w-one", "Second notice");
  expect(second.outcome).toBe("ok");
  expect((await f.admin.query("select reason from community_warnings where id = $1", [first.id])).rows[0].reason).toBe("Please keep replies kind.");
  // Hosts read all warnings of their community; members and the other ministry read none, and nobody writes directly.
  for (const user of ["w-mod", "w-admin", "w-owner"]) expect(await read(user, "community_warnings")).toHaveLength(2);
  for (const user of ["w-one", "w-two", "w-b-member", "w-b-owner"]) expect(await read(user, "community_warnings")).toEqual([]);
  expect(await withTenant(f.db, "w-b-owner", b, "communities:read", async (tx) => (await tx.execute(sql`select id from community_warnings`)).rows)).toEqual([]);
  await expect(withUser(f.db, "w-mod", (tx) => tx.execute(sql`update community_warnings set acknowledged_at = now()`))).rejects.toThrow();
  await expect(withUser(f.db, "w-one", (tx) => tx.execute(sql`delete from community_warnings`))).rejects.toThrow();
  // The member sees only their own unacknowledged warnings, without the issuer.
  const mine = await rows<Record<string, unknown>>("w-one", sql`select public.community_my_warnings('wb-club') as v`);
  expect(mine.map((w) => w.reason)).toEqual(["Please keep replies kind.", "Second notice"]);
  expect(Object.keys(mine[0]).sort()).toEqual(["createdAt", "id", "reason"]);
  expect(await rows("w-two", sql`select public.community_my_warnings('wb-club') as v`)).toEqual([]);
  expect(await rows("w-b-member", sql`select public.community_my_warnings('wb-club') as v`)).toEqual([]);
  expect((await ack("w-two", first.id!)).outcome).toBe("not_found");
  expect((await ack("w-one", first.id!)).outcome).toBe("ok");
  expect((await ack("w-one", first.id!)).outcome).toBe("not_found");
  expect((await rows("w-one", sql`select public.community_my_warnings('wb-club') as v`))).toHaveLength(1);
  const counts = await rows<{ userId: string; warnings: number }>("w-mod", sql`select public.community_moderation_members('wb-club') as v`);
  expect(counts.find((m) => m.userId === "w-one")?.warnings).toBe(2);
  expect(counts.find((m) => m.userId === "w-two")?.warnings).toBe(0);
  // Logged and audited.
  expect((await f.admin.query("select action, subject_user_id, actor_id from community_moderation_actions where action = 'warn' order by created_at")).rows)
    .toEqual([{ action: "warn", subject_user_id: "w-one", actor_id: "w-mod" }, { action: "warn", subject_user_id: "w-one", actor_id: "w-admin" }]);
  expect((await f.admin.query("select count(*)::int as n from audit_logs where tenant_id = $1 and action in ('community.moderation_warn', 'community.warning_ack')", [a])).rows[0].n).toBe(3);
});

it("lets a banned member send one appeal per ban; hosts decide; approval unbans", async () => {
  expect((await appeal("w-one", "Please reconsider")).outcome).toBe("not_found");
  expect((await moderate("w-mod", "w-two", "ban")).outcome).toBe("ok");
  expect((await appeal("w-two", "   ")).outcome).toBe("invalid");
  expect((await appeal("w-two", "x".repeat(1001))).outcome).toBe("invalid");
  expect((await appeal("w-two", "x", "other-wb-club")).outcome).toBe("not_found");
  expect((await appeal("w-b-member", "I was not banned")).outcome).toBe("not_found");
  const sent = await appeal("w-two", "  I am sorry and will follow the rules.  ");
  expect(sent.outcome).toBe("ok");
  expect((await appeal("w-two", "Again")).outcome).toBe("duplicate");
  // Banned people read nothing in the community, but see their own ban and appeal in the account list.
  expect(await read("w-two", "community_posts")).toEqual([]);
  const bans = await rows<{ slug: string; banned: boolean; canAppeal: boolean; appeal: { status: string; message: string; reply: string | null } }>("w-two", sql`select public.community_my_bans() as v`);
  expect(bans).toHaveLength(1);
  expect(bans[0]).toMatchObject({ slug: "wb-club", banned: true, canAppeal: false, appeal: { status: "open", message: "I am sorry and will follow the rules." } });
  expect(await rows("w-one", sql`select public.community_my_bans() as v`)).toEqual([]);
  // Hosts read appeals; members and ministry B do not; nobody writes directly.
  for (const user of ["w-mod", "w-admin", "w-owner"]) expect(await read(user, "community_appeals")).toHaveLength(1);
  for (const user of ["w-one", "w-two", "w-b-owner"]) expect(await read(user, "community_appeals")).toEqual([]);
  await expect(withUser(f.db, "w-mod", (tx) => tx.execute(sql`update community_appeals set status = 'approved'`))).rejects.toThrow();
  await expect(withUser(f.db, "w-two", (tx) => tx.execute(sql`insert into community_appeals (tenant_id, community_id, user_id, message) values (${a}::uuid, ${club}::uuid, 'w-two', 'x')`))).rejects.toThrow();
  // Decisions: members cannot; moderators may decline but not approve; replies are capped.
  expect((await decide("w-one", sent.id!, "decline")).outcome).toBe("forbidden");
  expect((await decide("w-mod", sent.id!, "approve")).outcome).toBe("forbidden");
  expect((await decide("w-mod", sent.id!, "maybe")).outcome).toBe("invalid");
  expect((await decide("w-mod", sent.id!, "decline", "x".repeat(501))).outcome).toBe("invalid");
  expect((await decide("w-b-owner", sent.id!, "decline")).outcome).toBe("not_found");
  expect((await decide("w-mod", sent.id!, "decline", "Not yet. Please wait a month.")).outcome).toBe("ok");
  expect((await decide("w-mod", sent.id!, "decline")).outcome).toBe("not_found");
  expect(await membership("w-two")).toMatchObject({ status: "banned" });
  const declined = await rows<{ appeal: { status: string; reply: string }; canAppeal: boolean }>("w-two", sql`select public.community_my_bans() as v`);
  expect(declined[0]).toMatchObject({ canAppeal: false, appeal: { status: "declined", reply: "Not yet. Please wait a month." } });
  expect((await appeal("w-two", "One more time")).outcome).toBe("duplicate");
  // Unmute cannot touch a banned membership, so the one-appeal-per-ban window stays closed (review on #65).
  expect((await moderate("w-owner", "w-two", "unmute")).outcome).toBe("invalid");
  expect((await rows<{ canAppeal: boolean }>("w-two", sql`select public.community_my_bans() as v`))[0].canAppeal).toBe(false);
  expect((await appeal("w-two", "After an unmute")).outcome).toBe("duplicate");
  // A new ban allows a new appeal; approval is an unban.
  expect((await moderate("w-owner", "w-two", "unban")).outcome).toBe("ok");
  expect((await moderate("w-mod", "w-two", "ban")).outcome).toBe("ok");
  expect((await rows<{ canAppeal: boolean }>("w-two", sql`select public.community_my_bans() as v`))[0].canAppeal).toBe(true);
  const again = await appeal("w-two", "Second ban, second appeal");
  expect(again.outcome).toBe("ok");
  expect((await decide("w-admin", again.id!, "approve", "Welcome back.")).outcome).toBe("ok");
  expect(await membership("w-two")).toMatchObject({ status: "left" });
  const approved = await rows<{ banned: boolean; appeal: { status: string; reply: string } }>("w-two", sql`select public.community_my_bans() as v`);
  expect(approved[0]).toMatchObject({ banned: false, appeal: { status: "approved", reply: "Welcome back." } });
  // An unban on the Members tab settles an open appeal as approved.
  await f.admin.query("update community_memberships set status = 'active' where community_id = $1 and user_id = 'w-three'", [club]);
  expect((await moderate("w-mod", "w-three", "ban")).outcome).toBe("ok");
  const third = await appeal("w-three", "Sorry");
  expect((await moderate("w-admin", "w-three", "unban")).outcome).toBe("ok");
  expect((await f.admin.query("select status, decided_by from community_appeals where id = $1", [third.id])).rows[0]).toEqual({ status: "approved", decided_by: "w-admin" });
  const log = (await f.admin.query("select action from community_moderation_actions where action like 'appeal_%' order by created_at")).rows.map((r) => r.action);
  expect(log).toEqual(["appeal_decline", "appeal_approve"]);
  expect((await f.admin.query("select count(*)::int as n from audit_logs where tenant_id = $1 and action in ('community.appeal_submit', 'community.moderation_appeal_approve', 'community.moderation_appeal_decline')", [a])).rows[0].n).toBe(5);
  // Put both back (a ban revokes the grants).
  await f.admin.query("update community_memberships set status = 'active' where community_id = $1 and user_id in ('w-two', 'w-three')", [club]);
  for (const user of ["w-two", "w-three"]) await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [a, user, club]);
});

it("keeps the previous version when a post or reply is edited, for hosts only", async () => {
  const target = await post("w-one", "First draft", null, "Original title");
  expect((await post("w-one", "First draft", target.id, "Original title")).outcome).toBe("ok");
  expect((await f.admin.query("select count(*)::int as n from community_post_revisions where post_id = $1", [target.id])).rows[0].n).toBe(0);
  expect((await post("w-one", "Second draft", target.id, "New title")).outcome).toBe("ok");
  expect((await post("w-one", "Third draft", target.id, "New title")).outcome).toBe("ok");
  const versions = (await f.admin.query("select title, body_text, body, saved_at, created_at from community_post_revisions where post_id = $1 order by created_at", [target.id])).rows;
  expect(versions.map((v) => [v.title, v.body_text])).toEqual([["Original title", "First draft"], ["New title", "Second draft"]]);
  expect(versions[0].body).toEqual(body("First draft"));
  expect(versions[0].saved_at <= versions[0].created_at).toBe(true);
  expect(versions[1].saved_at.getTime()).toBe(versions[0].created_at.getTime());
  const answer = await reply("w-two", target.id!, "Amen");
  expect((await reply("w-two", target.id!, "Amen", answer.id)).outcome).toBe("ok");
  expect((await reply("w-two", target.id!, "Amen, brothers", answer.id)).outcome).toBe("ok");
  expect((await reply("w-two", target.id!, "Amen, brothers and sisters", answer.id)).outcome).toBe("ok");
  expect((await f.admin.query("select body from community_comment_revisions where comment_id = $1 order by created_at", [answer.id])).rows.map((r) => r.body)).toEqual(["Amen", "Amen, brothers"]);
  for (const user of ["w-mod", "w-admin", "w-owner"]) {
    expect(await read(user, "community_post_revisions")).toHaveLength(2);
    expect(await read(user, "community_comment_revisions")).toHaveLength(2);
  }
  for (const user of ["w-one", "w-two", "w-b-member", "w-b-owner"]) {
    expect(await read(user, "community_post_revisions")).toEqual([]);
    expect(await read(user, "community_comment_revisions")).toEqual([]);
  }
  expect(await withTenant(f.db, "w-b-owner", b, "communities:read", async (tx) => (await tx.execute(sql`select id from community_post_revisions`)).rows)).toEqual([]);
  await expect(withUser(f.db, "w-mod", (tx) => tx.execute(sql`delete from community_post_revisions`))).rejects.toThrow();
  // Only the latest 50 versions are kept.
  for (let i = 0; i < 55; i++)
    await f.admin.query("insert into community_post_revisions (tenant_id, community_id, post_id, title, body, body_text, saved_at) values ($1, $2, $3, 'old', $4, 'old', now() - interval '1 day')",
      [a, club, target.id, JSON.stringify(body("old"))]);
  expect((await post("w-one", "Fourth draft", target.id, "New title")).outcome).toBe("ok");
  expect((await f.admin.query("select count(*)::int as n from community_post_revisions where post_id = $1", [target.id])).rows[0].n).toBe(50);
  expect((await f.admin.query("select body_text from community_post_revisions where post_id = $1 order by created_at desc limit 1", [target.id])).rows[0].body_text).toBe("Third draft");
});

it("accepts the new moderation actions and rejects unknown ones", async () => {
  await expect(f.admin.query("insert into community_moderation_actions (tenant_id, community_id, action, target_type, target_id) values ($1, $2, 'smite', 'member', 'x')", [a, club])).rejects.toThrow();
  await f.admin.query("insert into community_moderation_actions (tenant_id, community_id, action, target_type, target_id) values ($1, $2, 'warn', 'member', 'x')", [a, club]);
  expect(other).toBeTruthy();
});
