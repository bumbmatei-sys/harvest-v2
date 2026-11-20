import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { deletePost, memberDirectory, saveComment, savePost } from "../../src/server/community-forum";
import { memberProfile } from "../../src/server/community-member-profile";
import { ownCommunityProfile } from "../../src/server/community-profile-details";

// C09b screens: the read-only profile projection: neutral 404, viewer-readable activity, no held or removed content.
let f: Awaited<ReturnType<typeof testDatabase>>, general: string;
const slug = "profile-club";
const people = ["p-owner", "p-one", "p-two", "p-outsider"];
const body = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] }, { type: "paragraph", content: [{ type: "text", text }] }] });

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id === "p-two" ? "Second Member" : id, email: `${id}@example.test`, emailVerified: true })));
  const tenant = (await createWorkspace(f.db, "p-owner", "Profile Church", "church")).tenantId;
  const club = (await createCommunity(f.db, "p-owner", tenant, { name: "Profile club", slug })).id;
  const { version } = await getCommunity(f.db, "p-owner", tenant, club);
  const updated = await updateCommunity(f.db, "p-owner", tenant, club, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, "p-owner", tenant, club, { version: updated.version, published: true });
  for (const user of ["p-one", "p-two"]) await enterCommunity(f.db, user, slug, { rulesVersion: 0, adult: true });
  general = (await listCategories(f.db, "p-owner", tenant, club))[0].id;
});
afterAll(async () => { await f?.close(); });

it("answers the same neutral 404 for an outsider, an unknown person and a person who is not an active member", async () => {
  await expect(memberProfile(f.db, "p-outsider", slug, "p-one")).rejects.toMatchObject({ status: 404 });
  await expect(memberProfile(f.db, "p-one", slug, "p-outsider")).rejects.toMatchObject({ status: 404 });
  await expect(memberProfile(f.db, "p-one", slug, "nobody")).rejects.toMatchObject({ status: 404 });
  await expect(memberProfile(f.db, "p-one", slug, " ")).rejects.toMatchObject({ status: 404 });
  await expect(memberProfile(f.db, "p-one", "no-such-club", "p-one")).rejects.toMatchObject({ status: 404 });
});

it("shows name, role, joined day and own-page flag, and no private account fields", async () => {
  const peer = await memberProfile(f.db, "p-one", slug, "p-two");
  expect(peer.self).toBe(false);
  expect(peer.member).toMatchObject({ userId: "p-two", name: "Second Member", role: "member" });
  expect(Object.keys(peer.member).sort()).toEqual(["joinedAt", "name", "role", "userId"]);
  expect((await memberProfile(f.db, "p-one", slug, "p-one")).self).toBe(true);
  expect((await memberProfile(f.db, "p-one", slug, "p-owner")).member.role).toBe("owner");
});

it("lists the member's posts and replies newest first, with counts, and leaves out removed content", async () => {
  const first = await savePost(f.db, "p-two", slug, { categoryId: general, title: "First", body: body("Welcome all") });
  const second = await savePost(f.db, "p-two", slug, { categoryId: general, title: "Second", body: body("More words") });
  await saveComment(f.db, "p-two", slug, first.id!, { body: "A reply from two" });
  await saveComment(f.db, "p-one", slug, first.id!, { body: "Somebody else" });
  const view = await memberProfile(f.db, "p-one", slug, "p-two");
  expect(view).toMatchObject({ posts: 2, replies: 1, page: 1, hasMore: false });
  expect(view.activity.map((a) => `${a.kind}:${a.excerpt}`)).toEqual(["reply:A reply from two", expect.stringMatching(/^post:/), expect.stringMatching(/^post:/)]);
  expect(view.activity.every((a) => !a.excerpt.includes("Somebody else"))).toBe(true);
  await deletePost(f.db, "p-two", slug, second.id!);
  const after = await memberProfile(f.db, "p-owner", slug, "p-two");
  expect(after.posts).toBe(1);
  expect(after.activity.map((a) => a.postTitle)).not.toContain("Second");
});

it("shows a held first post only on its author's own profile", async () => {
  const [{ id: communityId }] = (await f.admin.query("select id from communities where slug = $1", [slug])).rows;
  const [{ id: postId }] = (await f.admin.query("select id from community_posts where author_id = 'p-two' and removed_at is null limit 1")).rows;
  await f.admin.query("update community_posts set held_at = now(), held_reason = 'first_post' where id = $1 and community_id = $2", [postId, communityId]);
  expect((await memberProfile(f.db, "p-one", slug, "p-two")).posts).toBe(0);
  expect((await memberProfile(f.db, "p-two", slug, "p-two")).posts).toBe(1);
});

it("pages the activity", async () => {
  for (let i = 0; i < 22; i++) await savePost(f.db, "p-one", slug, { categoryId: general, title: `Many ${i}`, body: body(`text ${i}`) });
  const one = await memberProfile(f.db, "p-two", slug, "p-one", 1), two = await memberProfile(f.db, "p-two", slug, "p-one", "2");
  expect(one.activity).toHaveLength(20);
  expect(one.hasMore).toBe(true);
  expect(two.activity.length).toBeGreaterThan(0);
  expect(new Set([...one.activity, ...two.activity].map((a) => a.id)).size).toBe(one.activity.length + two.activity.length);
  expect((await memberProfile(f.db, "p-two", slug, "p-one", "garbage")).page).toBe(1);
});

it("resolves a member beyond the directory cap and resolves an unlisted member by direct link", async () => {
  const [club] = (await f.admin.query("select id, tenant_id from communities where slug=$1", [slug])).rows;
  await f.admin.query(`insert into users(id,name,email)
    select 'profile-cap-' || n, 'Synthetic member ' || n, 'profile-cap-' || n || '@example.test'
    from generate_series(1, 1000) n`);
  await f.admin.query(`insert into community_memberships(tenant_id,community_id,user_id,role,status)
    select $1,$2,id,'contributor','active' from users where id like 'profile-cap-%'`, [club.tenant_id, club.id]);
  const directory = (await memberDirectory(f.db, "p-one", slug)).members;
  expect(directory).toHaveLength(1000);
  expect(directory.some(m => m.userId === "p-two")).toBe(false);
  await expect(memberProfile(f.db, "p-one", slug, "p-two")).resolves.toMatchObject({ member: { name: "Second Member" } });
  await ownCommunityProfile(f.db, "p-two", slug, "save", { version: 0, displayName: "Link-only name", visibility: "unlisted" });
  await expect(memberProfile(f.db, "p-one", slug, "p-two")).resolves.toMatchObject({ member: { name: "Link-only name" } });
  await f.admin.query("update community_memberships set status='left' where community_id=$1 and user_id='p-two'", [club.id]);
  for (const target of ["p-two", "p-outsider", "nobody"]) {
    await expect(memberProfile(f.db, "p-one", slug, target)).rejects.toMatchObject({ status: 404, message: "Community not found." });
  }
});
