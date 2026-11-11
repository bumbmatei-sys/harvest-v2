import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCategory, createCommunity, deleteCategory, getCommunity, listCategories, moveCategory, publishCommunity, updateCategory, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { deletePost, forumContext, getPost, listPosts, memberDirectory, moderate, saveComment, savePost, toggleLike } from "../../src/server/community-forum";
import { communityFileUrl, communityUploadReleased, confirmCommunityUpload, createCommunityUpload } from "../../src/server/community-files";
import type { StorageAdapter } from "../../src/server/storage/adapter";
import type { FileScanner } from "../../src/server/files/scanner";

// PR 4b services: forum context, posts with rich text and video, replies, likes, moderation, uploads, categories.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, club: string, general: string;
const people = ["g-owner", "g-viewer", "g-one", "g-two", "g-outsider"];
const body = (text: string) => ({ type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] }, { type: "paragraph", content: [{ type: "text", text }] }] });
const post = (user: string, extra: Record<string, unknown> = {}) => savePost(f.db, user, "grace-forum", { categoryId: general, title: "Hello", body: body("Welcome all"), ...extra });
const storage: StorageAdapter = {
  async presignUpload(key) { return { url: `https://storage.test/${key}`, method: "PUT", headers: {}, expiresIn: 60 }; },
  async inspect(key, expected) { return { size: (expected as { size: number }).size, mime: expected.mime, checksum: (expected as unknown as { checksum: string }).checksum }; },
  async presignDownload(key) { return `https://storage.test/${key}?signed=1`; },
};
const scanner = (verdict: "clean" | "infected" | "skipped"): FileScanner => ({ async scan() { return verdict; } });
const upload = async (user: string, kind: "cover" | "attachment", name: string, mime: string, verdict: "clean" | "infected" | "skipped" = "clean") => {
  const { file } = await createCommunityUpload(f.db, storage, user, "grace-forum", { kind, name, mime, size: 100, checksum: "b".repeat(64) });
  return confirmCommunityUpload(f.db, storage, user, "grace-forum", file.id, scanner(verdict));
};

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "g-owner", "Grace Church", "church")).tenantId;
  await putMember(f.db, "g-owner", a, "g-viewer@example.test", "viewer");
  club = (await createCommunity(f.db, "g-owner", a, { name: "Grace forum", slug: "grace-forum" })).id;
  const { version } = await getCommunity(f.db, "g-owner", a, club);
  const updated = await updateCommunity(f.db, "g-owner", a, club, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, "g-owner", a, club, { version: updated.version, published: true });
  for (const user of ["g-one", "g-two"]) await enterCommunity(f.db, user, "grace-forum", { rulesVersion: 0, adult: true });
  general = (await listCategories(f.db, "g-owner", a, club))[0].id;
});
afterAll(async () => { await f?.close(); });

it("gives members their forum context and hides it from everyone else", async () => {
  expect(await forumContext(f.db, "g-one", "grace-forum")).toMatchObject({ name: "Grace forum", role: "member", canModerate: false, categories: [{ name: "General", hostsOnly: false }] });
  expect(await forumContext(f.db, "g-owner", "grace-forum")).toMatchObject({ role: "owner", canModerate: true });
  expect(await forumContext(f.db, "g-outsider", "grace-forum")).toBeNull();
  expect(await forumContext(f.db, "g-viewer", "grace-forum")).toBeNull();
  await expect(listPosts(f.db, "g-outsider", "grace-forum")).rejects.toMatchObject({ status: 404 });
});

it("validates rich text and video links before saving", async () => {
  await expect(post("g-one", { body: { type: "doc", content: [{ type: "image" }] } })).rejects.toMatchObject({ status: 400 });
  await expect(post("g-one", { body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }] } })).rejects.toMatchObject({ status: 400 });
  await expect(post("g-one", { videoUrl: "http://insecure.test/v" })).rejects.toMatchObject({ status: 400 });
  const saved = await post("g-one", { videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  const { post: read } = await getPost(f.db, "g-two", "grace-forum", saved.id!);
  expect(read.video).toEqual({ kind: "embed", src: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" });
  expect(read.body.content[0]).toEqual({ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] });
  expect((await f.admin.query("select body_text from community_posts where id = $1", [saved.id])).rows[0].body_text).toBe("Title\nWelcome all");
});

it("lists pinned posts first for New, by likes this week for Best, and hides removed posts", async () => {
  const first = await post("g-one", { title: "First" }), second = await post("g-two", { title: "Second" }), third = await post("g-one", { title: "Third" });
  await moderate(f.db, "g-owner", "grace-forum", { action: "pin", targetId: first.id });
  await toggleLike(f.db, "g-one", "grace-forum", { targetType: "post", targetId: second.id });
  await toggleLike(f.db, "g-two", "grace-forum", { targetType: "post", targetId: second.id });
  await toggleLike(f.db, "g-two", "grace-forum", { targetType: "post", targetId: third.id });
  const fresh = (await listPosts(f.db, "g-two", "grace-forum")).posts;
  expect(fresh[0]).toMatchObject({ id: first.id, pinned: true });
  expect((await listPosts(f.db, "g-two", "grace-forum", { sort: "best" })).posts.slice(0, 2).map((p) => p.id)).toEqual([second.id, third.id]);
  expect(fresh.find((p) => p.id === third.id)).toMatchObject({ likes: 1, liked: true, comments: 0 });
  await deletePost(f.db, "g-one", "grace-forum", third.id!);
  expect((await listPosts(f.db, "g-two", "grace-forum")).posts.map((p) => p.id)).not.toContain(third.id);
  await expect(moderate(f.db, "g-one", "grace-forum", { action: "pin", targetId: second.id })).rejects.toMatchObject({ status: 403 });
});

it("shows replies, hides removed ones, and counts likes on replies", async () => {
  const p = await post("g-one");
  const reply = await saveComment(f.db, "g-two", "grace-forum", p.id!, { body: "Amen" });
  const removed = await saveComment(f.db, "g-two", "grace-forum", p.id!, { body: "Spam" });
  await moderate(f.db, "g-owner", "grace-forum", { action: "remove_comment", targetId: removed.id });
  await toggleLike(f.db, "g-one", "grace-forum", { targetType: "comment", targetId: reply.id });
  const { comments } = await getPost(f.db, "g-one", "grace-forum", p.id!);
  expect(comments).toEqual([expect.objectContaining({ id: reply.id, body: "Amen", authorName: "g-two", likes: 1, liked: true })]);
});

it("uploads covers and attachments, releases them only on a clean scan in production, and serves them to readers only", async () => {
  expect(communityUploadReleased("skipped", { NODE_ENV: "production" })).toBe(false);
  expect(communityUploadReleased("skipped", { NODE_ENV: "test" })).toBe(true);
  expect(communityUploadReleased("clean", { NODE_ENV: "production" })).toBe(true);
  expect(communityUploadReleased("infected", { NODE_ENV: "test" })).toBe(false);
  const cover = await upload("g-one", "cover", "cover.png", "image/png");
  const doc = await upload("g-one", "attachment", "notes.pdf", "application/pdf", "skipped");
  const bad = await upload("g-one", "attachment", "virus.pdf", "application/pdf", "infected");
  expect([cover.status, doc.status, bad.status]).toEqual(["ready", "ready", "quarantined"]);
  await expect(createCommunityUpload(f.db, storage, "g-one", "grace-forum", { kind: "cover", name: "c.pdf", mime: "application/pdf", size: 1, checksum: "b".repeat(64) })).rejects.toThrow();
  await expect(createCommunityUpload(f.db, storage, "g-outsider", "grace-forum", { kind: "attachment", name: "a.pdf", mime: "application/pdf", size: 1, checksum: "b".repeat(64) })).rejects.toMatchObject({ status: 404 });
  await expect(confirmCommunityUpload(f.db, storage, "g-two", "grace-forum", doc.id)).rejects.toMatchObject({ status: 404 });
  await expect(post("g-one", { attachmentIds: [bad.id] })).rejects.toMatchObject({ status: 400 });
  const saved = await post("g-one", { coverFileId: cover.id, attachmentIds: [doc.id] });
  const { post: read, attachments } = await getPost(f.db, "g-two", "grace-forum", saved.id!);
  expect(read.coverFileId).toBe(cover.id);
  expect(attachments).toEqual([{ id: doc.id, name: "notes.pdf", mime: "application/pdf", size: 100 }]);
  expect(await communityFileUrl(f.db, storage, "g-two", "grace-forum", doc.id)).toMatch(/^https:\/\/storage\.test\/workspaces\/.+\/communities\/.+\/files\/.+\?signed=1$/);
  await expect(communityFileUrl(f.db, storage, "g-outsider", "grace-forum", doc.id)).rejects.toMatchObject({ status: 404 });
  await expect(communityFileUrl(f.db, storage, "g-one", "grace-forum", bad.id)).rejects.toMatchObject({ status: 404 });
});

it("lists members with names and roles only, for readers", async () => {
  const { members } = await memberDirectory(f.db, "g-two", "grace-forum");
  expect(members.map((m) => [m.name, m.role])).toEqual([["g-owner", "owner"], ["g-one", "member"], ["g-two", "member"]]);
  expect(Object.keys(members[0]).sort()).toEqual(["joinedAt", "name", "role", "userId"]);
  await expect(memberDirectory(f.db, "g-outsider", "grace-forum")).rejects.toMatchObject({ status: 404 });
});

it("lets owners manage categories, keeps hosts-only for hosts, and refuses viewers", async () => {
  const hosts = await createCategory(f.db, "g-owner", a, club, { name: "Announcements", emoji: "📣", hostsOnly: true });
  await expect(post("g-one", { categoryId: hosts.id })).rejects.toMatchObject({ status: 403 });
  expect((await post("g-owner", { categoryId: hosts.id })).outcome).toBe("ok");
  await updateCategory(f.db, "g-owner", a, club, hosts.id, { name: "News", emoji: null, hostsOnly: true });
  expect(await moveCategory(f.db, "g-owner", a, club, hosts.id, { direction: "up" })).toEqual({ moved: true });
  expect((await listCategories(f.db, "g-owner", a, club)).map((c) => c.name)).toEqual(["News", "General"]);
  await expect(deleteCategory(f.db, "g-owner", a, club, hosts.id)).rejects.toMatchObject({ status: 409 });
  const empty = await createCategory(f.db, "g-owner", a, club, { name: "Empty" });
  await deleteCategory(f.db, "g-owner", a, club, empty.id);
  await expect(createCategory(f.db, "g-viewer", a, club, { name: "No" })).rejects.toMatchObject({ status: 403 });
  expect((await listCategories(f.db, "g-viewer", a, club)).length).toBe(2);
});
