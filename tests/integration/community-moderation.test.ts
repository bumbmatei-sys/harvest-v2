import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { forumContext, getPost, listPosts, saveComment, savePost, toggleLike } from "../../src/server/community-forum";
import { decideHeld, decideReport, heldItems, moderateMember, moderationCount, moderationHistory, moderationMembers, moderationQueue, reportContent } from "../../src/server/community-moderation";

// C12a services: reports and the queue, held content, member moderation, owner settings.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, club: string, general: string;
const people = ["h-owner", "h-one", "h-two", "h-three", "h-new", "h-outsider"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const post = (user: string, text = "Welcome all", title = "Hello") => savePost(f.db, user, "mod-forum", { categoryId: general, title, body: body(text) });
const settings = async (changes: Record<string, unknown>) => {
  const { version } = await getCommunity(f.db, "h-owner", a, club);
  return updateCommunity(f.db, "h-owner", a, club, { version, ...changes });
};

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "h-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "h-owner", a, { name: "Mod forum", slug: "mod-forum" })).id;
  const updated = await settings({ visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, "h-owner", a, club, { version: updated.version, published: true });
  for (const user of ["h-one", "h-two", "h-three"]) await enterCommunity(f.db, user, "mod-forum", { rulesVersion: 0, adult: true });
  general = (await listCategories(f.db, "h-owner", a, club))[0].id;
});
afterAll(async () => { await f?.close(); });

it("groups open reports by target for hosts, without reporter ids, and refuses non-hosts", async () => {
  const target = await post("h-one", "Buy my stuff");
  await reportContent(f.db, "h-two", "mod-forum", { targetType: "post", targetId: target.id, reason: "spam", note: "Advertising" });
  await reportContent(f.db, "h-three", "mod-forum", { targetType: "post", targetId: target.id, reason: "inappropriate" });
  await reportContent(f.db, "h-two", "mod-forum", { targetType: "member", targetId: "h-one", reason: "harassment" });
  await expect(reportContent(f.db, "h-two", "mod-forum", { targetType: "post", targetId: target.id, reason: "spam" })).rejects.toMatchObject({ status: 409 });
  await expect(reportContent(f.db, "h-one", "mod-forum", { targetType: "post", targetId: target.id, reason: "spam" })).rejects.toMatchObject({ status: 403 });
  await expect(reportContent(f.db, "h-outsider", "mod-forum", { targetType: "post", targetId: target.id, reason: "spam" })).rejects.toMatchObject({ status: 404 });
  await expect(reportContent(f.db, "h-two", "mod-forum", { targetType: "post", targetId: "not-a-uuid", reason: "spam" })).rejects.toThrow();
  const { items } = await moderationQueue(f.db, "h-owner", "mod-forum");
  expect(items).toHaveLength(2);
  const top = items[0];
  expect(top).toMatchObject({ targetType: "post", targetId: target.id, reports: 2, title: "Hello", excerpt: "Buy my stuff", authorName: "Name h-one", notes: ["Advertising"] });
  expect([...top.reasons].sort()).toEqual(["inappropriate", "spam"]);
  expect(JSON.stringify(items)).not.toMatch(/h-two|h-three/);
  for (const user of ["h-one", "h-two", "h-outsider"]) await expect(moderationQueue(f.db, user, "mod-forum")).rejects.toMatchObject({ status: 404 });
  expect(await moderationCount(f.db, "h-owner", "mod-forum")).toBe(2);
  expect(await moderationCount(f.db, "h-one", "mod-forum")).toBeNull();
  await decideReport(f.db, "h-owner", "mod-forum", top.reportId, { decision: "remove" });
  await expect(getPost(f.db, "h-two", "mod-forum", target.id!)).rejects.toMatchObject({ status: 404 });
  const member = (await moderationQueue(f.db, "h-owner", "mod-forum")).items[0];
  await expect(decideReport(f.db, "h-owner", "mod-forum", member.reportId, { decision: "remove" })).rejects.toMatchObject({ status: 400 });
  await decideReport(f.db, "h-owner", "mod-forum", member.reportId, { decision: "keep" });
  expect((await moderationQueue(f.db, "h-owner", "mod-forum")).items).toEqual([]);
});

it("mutes and bans through the service, shows the mute in the member's context, and lists members for hosts", async () => {
  await moderateMember(f.db, "h-owner", "mod-forum", { userId: "h-three", action: "mute", days: 1 });
  expect((await forumContext(f.db, "h-three", "mod-forum"))!.mutedUntil).toBeInstanceOf(Date);
  await expect(post("h-three")).rejects.toMatchObject({ status: 403 });
  await expect(moderateMember(f.db, "h-owner", "mod-forum", { userId: "h-three", action: "mute" })).rejects.toMatchObject({ status: 400 });
  await expect(moderateMember(f.db, "h-one", "mod-forum", { userId: "h-three", action: "unmute" })).rejects.toMatchObject({ status: 403 });
  await moderateMember(f.db, "h-owner", "mod-forum", { userId: "h-three", action: "unmute" });
  expect((await forumContext(f.db, "h-three", "mod-forum"))!.mutedUntil).toBeNull();
  await moderateMember(f.db, "h-owner", "mod-forum", { userId: "h-three", action: "ban" });
  expect(await forumContext(f.db, "h-three", "mod-forum")).toBeNull();
  const { members } = await moderationMembers(f.db, "h-owner", "mod-forum");
  expect(members.find((m) => m.userId === "h-three")).toMatchObject({ status: "banned", role: "member" });
  expect(members.find((m) => m.userId === "h-owner")).toMatchObject({ status: "active", role: "owner" });
  await expect(moderationMembers(f.db, "h-one", "mod-forum")).rejects.toMatchObject({ status: 404 });
  await moderateMember(f.db, "h-owner", "mod-forum", { userId: "h-three", action: "unban" });
  await enterCommunity(f.db, "h-three", "mod-forum", { rulesVersion: 0, adult: true });
  expect(await forumContext(f.db, "h-three", "mod-forum")).not.toBeNull();
  const { entries } = await moderationHistory(f.db, "h-owner", "mod-forum");
  expect(entries.slice(0, 4).map((e) => e.action)).toEqual(["unban", "ban", "unmute", "mute"]);
  expect(entries[0]).toMatchObject({ actorName: "Name h-owner", subjectName: "Name h-three" });
});

it("saves owner settings, holds first posts and banned words, and shows held items only to their author and hosts", async () => {
  await expect(settings({ bannedWords: ["x".repeat(41)] })).rejects.toMatchObject({ status: 400 });
  const saved = await settings({ holdFirstPosts: true, bannedWords: [" Casino ", "casino", "Buy Now"] });
  expect(saved).toMatchObject({ holdFirstPosts: true, bannedWords: ["casino", "buy now"] });
  await enterCommunity(f.db, "h-new", "mod-forum", { rulesVersion: 0, adult: true });
  const first = await post("h-new", "Hello friends", "First");
  expect(first.outcome).toBe("held");
  const listed = (await listPosts(f.db, "h-new", "mod-forum")).posts.find((p) => p.id === first.id);
  expect(listed).toMatchObject({ held: true });
  expect((await listPosts(f.db, "h-one", "mod-forum")).posts.map((p) => p.id)).not.toContain(first.id);
  expect((await listPosts(f.db, "h-owner", "mod-forum")).posts.map((p) => p.id)).not.toContain(first.id);
  await expect(getPost(f.db, "h-one", "mod-forum", first.id!)).rejects.toMatchObject({ status: 404 });
  expect((await getPost(f.db, "h-owner", "mod-forum", first.id!)).post.held).toBe(true);
  expect((await getPost(f.db, "h-new", "mod-forum", first.id!)).post.held).toBe(true);
  const open = await post("h-owner", "A clean post", "Clean");
  const reply = await saveComment(f.db, "h-two", "mod-forum", open.id!, { body: "Casino tonight!" });
  expect(reply.outcome).toBe("held");
  expect((await getPost(f.db, "h-one", "mod-forum", open.id!)).comments).toEqual([]);
  expect((await getPost(f.db, "h-two", "mod-forum", open.id!)).comments.map((c) => c.held)).toEqual([true]);
  expect((await listPosts(f.db, "h-one", "mod-forum")).posts.find((p) => p.id === open.id)!.comments).toBe(0);
  await expect(toggleLike(f.db, "h-one", "mod-forum", { targetType: "comment", targetId: reply.id })).rejects.toMatchObject({ status: 404 });
  const { items } = await heldItems(f.db, "h-owner", "mod-forum");
  expect(items.map((i) => [i.targetType, i.reason])).toEqual([["post", "first_post"], ["comment", "banned_word"]]);
  await expect(heldItems(f.db, "h-one", "mod-forum")).rejects.toMatchObject({ status: 404 });
  await decideHeld(f.db, "h-owner", "mod-forum", { targetType: "post", id: first.id, decision: "approve" });
  await decideHeld(f.db, "h-owner", "mod-forum", { targetType: "comment", id: reply.id, decision: "reject" });
  expect((await listPosts(f.db, "h-one", "mod-forum")).posts.map((p) => p.id)).toContain(first.id);
  expect((await heldItems(f.db, "h-owner", "mod-forum")).items).toEqual([]);
  await settings({ holdFirstPosts: false, bannedWords: [] });
});
