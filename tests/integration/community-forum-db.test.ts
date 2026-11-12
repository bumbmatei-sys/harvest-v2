import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";

// PR 4b (migration 0038): forum read rules through community_can_read, and every member write through a definer.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, club: string, other: string, general: string, hosts: string;
const people = ["f-owner", "f-mod", "f-one", "f-two", "f-banned", "f-pending", "f-nogrant", "f-b-owner", "f-other-member"];
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] };
type Out = { outcome: string; id: string | null };
const call = (user: string, statement: ReturnType<typeof sql>) => withUser(f.db, user, async (tx) => (await tx.execute<{ v: Out }>(statement)).rows[0].v);
const savePost = (user: string, category: string, extra: { post?: string | null; cover?: string | null; attachments?: string[]; commentsOff?: boolean; likesOff?: boolean; slug?: string } = {}) =>
  call(user, sql`select public.community_post_save(${extra.slug ?? "forum-club"}, ${extra.post ?? null}::uuid, ${category}::uuid, 'A post', ${JSON.stringify(body)}::jsonb, 'Hello',
    null, ${extra.cover ?? null}::uuid, ${`{${(extra.attachments ?? []).join(",")}}`}::uuid[], ${extra.commentsOff ?? false}, ${extra.likesOff ?? false}) as v`);
const read = (user: string, table: string) => withUser(f.db, user, async (tx) => (await tx.execute(sql.raw(`select * from ${table}`))).rows);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "f-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "f-b-owner", "Other", "creator")).tenantId;
  club = (await createCommunity(f.db, "f-owner", a, { name: "Forum club", slug: "forum-club" })).id;
  other = (await createCommunity(f.db, "f-b-owner", b, { name: "Other club", slug: "other-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = any($1)", [[club, other]]);
  const member = async (user: string, community: string, tenant: string, role: string, status: string, grant = true) => {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status) values ($1, $2, $3, $4, $5)", [tenant, community, user, role, status]);
    if (grant) await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [tenant, user, community]);
  };
  await member("f-mod", club, a, "moderator", "active", false);
  await member("f-one", club, a, "member", "active");
  await member("f-two", club, a, "member", "active");
  await member("f-banned", club, a, "member", "banned");
  await member("f-pending", club, a, "member", "pending");
  await member("f-nogrant", club, a, "member", "active", false);
  await member("f-other-member", other, b, "member", "active");
  general = (await f.admin.query("select id from community_categories where community_id = $1 and name = 'General'", [club])).rows[0].id;
  hosts = (await f.admin.query("insert into community_categories (tenant_id, community_id, name, hosts_only, position) values ($1, $2, 'Announcements', true, 1) returning id", [a, club])).rows[0].id;
});
afterAll(async () => { await f?.close(); });

it("creates a General category for every community", async () => {
  expect((await f.admin.query("select count(*)::int as n from community_categories where name = 'General'")).rows[0].n).toBe(2);
});

it("lets active members with a grant (or a host role) post and read; nobody else", async () => {
  const post = await savePost("f-one", general);
  expect(post.outcome).toBe("ok");
  for (const user of ["f-two", "f-mod", "f-owner"]) expect((await read(user, "community_posts")).map((r) => r.id)).toEqual([post.id]);
  for (const user of ["f-banned", "f-pending", "f-nogrant", "f-other-member", "f-b-owner"]) expect(await read(user, "community_posts")).toEqual([]);
  for (const user of ["f-banned", "f-pending", "f-nogrant", "f-other-member"]) expect((await savePost(user, general)).outcome).toBe("not_found");
  expect((await savePost("f-other-member", general, { slug: "other-club" })).outcome).toBe("invalid");
  // Ministry staff read through the staff path.
  expect(await withTenant(f.db, "f-owner", a, "communities:read", async (tx) => (await tx.execute(sql`select id from community_posts`)).rows)).toHaveLength(1);
  expect(await withTenant(f.db, "f-b-owner", b, "communities:read", async (tx) => (await tx.execute(sql`select id from community_posts`)).rows)).toEqual([]);
  // Members cannot write the tables directly.
  await expect(withUser(f.db, "f-one", (tx) => tx.execute(sql`update community_posts set pinned = true`))).resolves.toBeDefined();
  expect((await f.admin.query("select pinned from community_posts where id = $1", [post.id])).rows[0].pinned).toBe(false);
});

it("keeps hosts-only categories for hosts, and edits and deletes to authors", async () => {
  expect((await savePost("f-one", hosts)).outcome).toBe("forbidden");
  expect((await savePost("f-mod", hosts)).outcome).toBe("ok");
  const mine = await savePost("f-one", general);
  expect((await savePost("f-two", general, { post: mine.id })).outcome).toBe("forbidden");
  expect((await savePost("f-one", general, { post: mine.id })).outcome).toBe("ok");
  expect((await f.admin.query("select edited_at is not null as edited from community_posts where id = $1", [mine.id])).rows[0].edited).toBe(true);
  expect((await call("f-two", sql`select public.community_post_delete('forum-club', ${mine.id}::uuid) as v`)).outcome).toBe("forbidden");
  expect((await call("f-one", sql`select public.community_post_delete('forum-club', ${mine.id}::uuid) as v`)).outcome).toBe("ok");
  expect((await savePost("f-one", general, { post: mine.id })).outcome).toBe("not_found");
});

it("replies and likes respect the post's switches, and likes toggle once per person", async () => {
  const open = await savePost("f-one", general), closed = await savePost("f-one", general, { commentsOff: true, likesOff: true });
  const reply = (user: string, post: string, comment: string | null = null, text = "Amen") =>
    call(user, sql`select public.community_comment_save('forum-club', ${post}::uuid, ${comment}::uuid, ${text}) as v`);
  const like = (user: string, type: string, id: string) => call(user, sql`select public.community_like_toggle('forum-club', ${type}, ${id}::uuid) as v`);
  const comment = await reply("f-two", open.id!);
  expect(comment.outcome).toBe("ok");
  expect((await reply("f-two", closed.id!)).outcome).toBe("forbidden");
  expect((await reply("f-one", open.id!, comment.id, "Edited")).outcome).toBe("forbidden");
  expect((await reply("f-two", open.id!, comment.id, "Edited")).outcome).toBe("ok");
  expect((await like("f-two", "post", open.id!)).outcome).toBe("liked");
  expect((await like("f-two", "post", open.id!)).outcome).toBe("unliked");
  expect((await like("f-two", "post", open.id!)).outcome).toBe("liked");
  expect((await like("f-one", "comment", comment.id!)).outcome).toBe("liked");
  expect((await like("f-two", "post", closed.id!)).outcome).toBe("forbidden");
  expect((await like("f-other-member", "post", open.id!)).outcome).toBe("not_found");
  expect((await f.admin.query("select count(*)::int as n from community_likes where target_id = $1", [open.id])).rows[0].n).toBe(1);
  expect((await call("f-one", sql`select public.community_comment_delete('forum-club', ${comment.id}::uuid) as v`)).outcome).toBe("forbidden");
  expect((await call("f-two", sql`select public.community_comment_delete('forum-club', ${comment.id}::uuid) as v`)).outcome).toBe("ok");
});

it("lets hosts pin and remove, and nobody else", async () => {
  const post = await savePost("f-two", general);
  const moderate = (user: string, action: string, id: string) => call(user, sql`select public.community_moderate('forum-club', ${action}, ${id}::uuid) as v`);
  expect((await moderate("f-one", "pin", post.id!)).outcome).toBe("forbidden");
  expect((await moderate("f-mod", "pin", post.id!)).outcome).toBe("ok");
  expect((await f.admin.query("select pinned from community_posts where id = $1", [post.id])).rows[0].pinned).toBe(true);
  const comment = await call("f-one", sql`select public.community_comment_save('forum-club', ${post.id}::uuid, null, 'Hi') as v`);
  expect((await moderate("f-owner", "remove_comment", comment.id!)).outcome).toBe("ok");
  expect((await moderate("f-owner", "remove_post", post.id!)).outcome).toBe("ok");
  expect((await moderate("f-owner", "remove_post", post.id!)).outcome).toBe("not_found");
  expect((await moderate("f-mod", "explode", post.id!)).outcome).toBe("invalid");
  expect((await f.admin.query("select count(*)::int as n from audit_logs where action in ('community.pin', 'community.remove_post', 'community.remove_comment')")).rows[0].n).toBe(3);
});

it("attaches only the author's own ready files of the right kind, at most five", async () => {
  const file = async (user: string, kind: string, mime: string, status: string) => {
    const id = crypto.randomUUID();
    expect((await call(user, sql`select public.community_file_create('forum-club', ${id}::uuid, ${kind}, ${kind === "cover" ? "c.png" : "a.pdf"}, ${mime}, 10, ${"a".repeat(64)}) as v`)).outcome).toBe("ok");
    if (status !== "pending") {
      expect((await call(user, sql`select public.community_file_set_status('forum-club', ${id}::uuid, 'uploaded') as v`)).outcome).toBe("ok");
      if (status !== "uploaded") expect((await call(user, sql`select public.community_file_set_status('forum-club', ${id}::uuid, ${status}) as v`)).outcome).toBe("ok");
    }
    return id;
  };
  const cover = await file("f-one", "cover", "image/png", "ready"), doc = await file("f-one", "attachment", "application/pdf", "ready");
  const pending = await file("f-one", "attachment", "application/pdf", "pending"), quarantined = await file("f-one", "attachment", "application/pdf", "quarantined");
  const theirs = await file("f-two", "attachment", "application/pdf", "ready");
  await expect(call("f-one", sql`select public.community_file_create('forum-club', ${crypto.randomUUID()}::uuid, 'cover', 'x.pdf', 'application/pdf', 10, ${"a".repeat(64)}) as v`)).rejects.toThrow();
  expect((await call("f-two", sql`select public.community_file_set_status('forum-club', ${cover}::uuid, 'quarantined') as v`)).outcome).toBe("not_found");
  expect((await call("f-one", sql`select public.community_file_set_status('forum-club', ${cover}::uuid, 'uploaded') as v`)).outcome).toBe("invalid");
  for (const bad of [[pending], [quarantined], [theirs], [cover]]) expect((await savePost("f-one", general, { attachments: bad })).outcome).toBe("invalid");
  expect((await savePost("f-one", general, { cover: doc })).outcome).toBe("invalid");
  const post = await savePost("f-one", general, { cover, attachments: [doc] });
  expect(post.outcome).toBe("ok");
  expect((await f.admin.query("select post_id from community_files where id = any($1)", [[cover, doc]])).rows.map((r) => r.post_id)).toEqual([post.id, post.id]);
  // A file already on one post cannot be used on another.
  expect((await savePost("f-one", general, { attachments: [doc] })).outcome).toBe("invalid");
  // Editing without the attachment frees it.
  expect((await savePost("f-one", general, { post: post.id, cover })).outcome).toBe("ok");
  expect((await f.admin.query("select post_id from community_files where id = $1", [doc])).rows[0].post_id).toBeNull();
  // Members see other people's files only when ready.
  expect((await read("f-two", "community_files")).map((r) => r.id).sort()).toEqual([cover, doc, theirs].sort());
});
