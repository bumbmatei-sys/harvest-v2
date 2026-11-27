import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, updateCommunity } from "../../src/server/communities";
import { forumContext, forumItemPicker, getPost, listPosts } from "../../src/server/community-forum";
import { createCrmForm, getCrmForm, saveCrmForm } from "../../src/server/crm-forms";
import { transitionCrmForm } from "../../src/server/crm-form-publication";

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
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
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

it("combines forum-wide posting settings with category restrictions while replies remain open", async () => {
  expect(await forumContext(f.db, "f-two", "forum-club")).toMatchObject({ forumPosting: "everyone", canCreatePost: true });
  const initial = await getCommunity(f.db, "f-owner", a, club);
  const locked = await updateCommunity(f.db, "f-owner", a, club, { version: initial.version, forumPosting: "hosts" });
  expect(locked.forumPosting).toBe("hosts");
  try {
    expect(await forumContext(f.db, "f-two", "forum-club")).toMatchObject({ forumPosting: "hosts", canCreatePost: false });
    expect(await forumContext(f.db, "f-mod", "forum-club")).toMatchObject({ canCreatePost: true });
    expect((await savePost("f-two", general)).outcome).toBe("forbidden");
    expect((await savePost("f-two", hosts)).outcome).toBe("forbidden");
    const post = await savePost("f-mod", hosts);
    expect(post.outcome).toBe("ok");
    expect((await call("f-two", sql`select public.community_comment_save('forum-club', ${post.id}::uuid, null, 'Amen') as v`)).outcome).toBe("ok");
  } finally {
    await updateCommunity(f.db, "f-owner", a, club, { version: locked.version, forumPosting: "everyone" });
  }
  expect((await savePost("f-two", hosts)).outcome).toBe("forbidden");
});

it("validates photos, address, feeling and current unblocked mentions in the post definer", async () => {
  const photo = crypto.randomUUID();
  expect((await call("f-two", sql`select public.community_file_create('forum-club', ${photo}::uuid, 'attachment', 'photo.png', 'image/png', 10, ${"a".repeat(64)}) as v`)).outcome).toBe("ok");
  for (const state of ["uploaded", "ready"]) expect((await call("f-two", sql`select public.community_file_set_status('forum-club', ${photo}::uuid, ${state}) as v`)).outcome).toBe("ok");
  const save = (user: string, details: object, post: string | null = null) => call(user, sql`
    select public.community_post_save_details('forum-club', ${post}::uuid, ${general}::uuid, 'A post', ${JSON.stringify(body)}::jsonb, 'Hello',
      null, null, '{}'::uuid[], false, false, ${JSON.stringify({ photoIds: [], mentionIds: [], linkedItems: [], ...details })}::jsonb) as v`);
  expect((await save("f-two", { photoIds: Array.from({ length: 11 }, () => crypto.randomUUID()) })).outcome).toBe("invalid");
  expect((await save("f-two", { feeling: "anything" })).outcome).toBe("invalid");
  expect((await save("f-two", { location: { lat: 1, lng: 2 } })).outcome).toBe("invalid");
  expect((await save("f-two", { mentionIds: ["f-other-member"] })).outcome).toBe("invalid");
  await f.admin.query("insert into community_dm_blocks(tenant_id,community_id,blocker_id,blocked_id) values($1,$2,'f-one','f-two')", [a, club]);
  expect((await save("f-two", { mentionIds: ["f-one"] })).outcome).toBe("invalid");
  await f.admin.query("delete from community_dm_blocks");
  expect((await save("f-mod", { photoIds: [photo] })).outcome).toBe("invalid");
  const post = await save("f-two", { photoIds: [photo], location: "100 Example Street", feeling: "grateful", mentionIds: ["f-one"] });
  expect(post.outcome).toBe("ok");
  const revealed = await getPost(f.db, "f-one", "forum-club", post.id!);
  expect(revealed.post.postDetails).toMatchObject({ photos: [{ id: photo }], location: "100 Example Street", feeling: "grateful", mentions: [{ userId: "f-one", name: "f-one" }] });
  expect(revealed.attachments).toEqual([]);
  expect((await savePost("f-two", general, { post: post.id })).outcome).toBe("ok");
  await expect(read("f-one", "community_post_details")).rejects.toHaveProperty("cause.code", "42501");
  expect(await withUser(f.db, "f-other-member", async (tx) =>
    (await tx.execute(sql`select * from public.community_forum_read_details('forum-club', ${"{" + post.id + "}"}::uuid[])`)).rows)).toEqual([]);
  await f.admin.query("update community_memberships set status='left' where community_id=$1 and user_id='f-two'", [club]);
  try {
    expect((await getPost(f.db, "f-one", "forum-club", post.id!)).post).toMatchObject({ authorId: null, authorName: "Former member", postDetails: { photos: [{ id: photo }] } });
    expect((await listPosts(f.db, "f-one", "forum-club")).posts.find((item) => item.id === post.id)).toMatchObject({ authorId: null, authorName: "Former member" });
  } finally {
    await f.admin.query("update community_memberships set status='active' where community_id=$1 and user_id='f-two'", [club]);
  }
});

it("limits linked items to hosts and resolves only viewable same-ministry cards", async () => {
  const addCatalog = async (tenant: string, kind: "course" | "download", name: string, publish: boolean) =>
    (await f.admin.query("insert into catalog_items(tenant_id,kind,slug,title,state,visibility) values($1,$2,$3,$4,$5,$6) returning id", [
      tenant, kind, name.toLowerCase().replaceAll(" ", "-"), name, publish ? "published" : "draft", publish ? "listed" : "hidden",
    ])).rows[0].id as string;
  const course = await addCatalog(a, "course", "Example Class", true), product = await addCatalog(a, "download", "Example Download", true);
  const hidden = await addCatalog(a, "download", "Example Draft", false), foreign = await addCatalog(b, "download", "Foreign Example", true);
  const event = crypto.randomUUID(), privateEvent = crypto.randomUUID();
  for (const id of [event, privateEvent]) await f.admin.query(
    "insert into events(tenant_id,id,title,time_zone,starts_at,ends_at,status,published_at) values($1,$2,$3,'UTC',now()+interval '1 day',now()+interval '2 days','published',now())",
    [a, id, id === event ? "Example Event" : "Private Event"]);
  await f.admin.query("insert into community_event_links(tenant_id,event_id,community_id) values($1,$2,$3)", [a, event, club]);
  const { id: form } = await createCrmForm(f.db, "f-owner", a, { destination: { type: "people" } });
  const { definition } = await getCrmForm(f.db, "f-owner", a, form);
  definition.blocks.unshift(
    { id: "fullname", type: "short", label: "Name", required: true, mapTo: "name" },
    { id: "email000", type: "email", label: "Email", required: false, mapTo: "email" },
  );
  const draft = await saveCrmForm(f.db, "f-owner", a, form, { definition, revision: definition.revision });
  vi.stubEnv("HARVEST_CRM_FORMS", "synthetic");
  vi.stubEnv("HARVEST_CRM_FORMS_TEST_KEY", "37".repeat(32));
  vi.stubEnv("DATABASE_URL", f.appURL);
  try {
    await transitionCrmForm(f.db, "f-owner", a, form, { action: "publish", slug: "forum-example-form", revision: draft.revision });
  } finally { vi.unstubAllEnvs(); }
  const save = (user: string, linkedItems: { kind: string; id: string }[]) => call(user, sql`
    select public.community_post_save_details('forum-club',null,${general}::uuid,'A post',${JSON.stringify(body)}::jsonb,'Hello',
      null,null,'{}'::uuid[],false,false,${JSON.stringify({ linkedItems, photoIds: [], mentionIds: [] })}::jsonb) as v`);
  const links = [{ kind: "course", id: course }, { kind: "product", id: product }, { kind: "event", id: event }, { kind: "form", id: form }, { kind: "event", id: privateEvent }];
  for (const link of links) expect((await save("f-two", [link])).outcome).toBe("forbidden");
  for (const id of [foreign, hidden]) expect((await save("f-owner", [{ kind: "product", id }])).outcome).toBe("invalid");
  expect((await save("f-owner", [...links, { kind: "product", id: hidden }])).outcome).toBe("invalid");
  const post = await save("f-owner", links);
  expect(post.outcome).toBe("ok");
  await expect(forumItemPicker(f.db, "f-two", "forum-club", { kind: "product" })).rejects.toMatchObject({ status: 403 });
  expect(await forumItemPicker(f.db, "f-mod", "forum-club", { kind: "product", q: "exa" })).toMatchObject({ items: [{ id: product }], hasMore: false });
  expect(await forumItemPicker(f.db, "f-owner", "forum-club", { kind: "product", page: 2 })).toMatchObject({ items: [] });
  expect(await forumItemPicker(f.db, "f-owner", "forum-club", { kind: "article" })).toMatchObject({ items: [] });
  expect((await getPost(f.db, "f-one", "forum-club", post.id!)).post.postDetails.linkedItems).toEqual([
    expect.objectContaining({ id: course, available: true, href: "/courses/example-class", price: "free" }),
    expect.objectContaining({ id: product, available: true, href: "/products/example-download" }),
    expect.objectContaining({ id: event, available: true, href: "/communities/forum-club/events/" + event }),
    expect.objectContaining({ id: form, available: true, href: "/f/forum-example-form" }),
    { id: privateEvent, kind: "event", available: false, title: "No longer available" },
  ]);
  await f.admin.query("update catalog_items set state='archived',visibility='hidden' where id=$1", [product]);
  expect((await getPost(f.db, "f-one", "forum-club", post.id!)).post.postDetails.linkedItems[1]).toEqual(
    { id: product, kind: "product", available: false, title: "No longer available" });
});
