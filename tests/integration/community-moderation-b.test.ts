import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, listCategories, publishCommunity, updateCommunity, getCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import { getPost, saveComment, savePost } from "../../src/server/community-forum";
import { acknowledgeWarning, decideAppeal, editHistory, moderateMember, moderationAppeals, moderationCount, moderationMembers, myBans, myWarnings, submitAppeal, warnMember } from "../../src/server/community-moderation";

// C12b services: warnings, appeals by banned members, and edit history for hosts.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, club: string, general: string;
const people = ["b-owner", "b-mod", "b-one", "b-two", "b-outsider"];
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const slug = "mod-b-forum";
const post = (user: string, text: string, title = "Hello", id?: string) => savePost(f.db, user, slug, { categoryId: general, title, body: body(text) }, id);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Name ${id}`, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "b-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "b-owner", a, { name: "Mod B forum", slug })).id;
  const { version } = await getCommunity(f.db, "b-owner", a, club);
  const updated = await updateCommunity(f.db, "b-owner", a, club, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, "b-owner", a, club, { version: updated.version, published: true });
  for (const user of ["b-mod", "b-one", "b-two"]) await enterCommunity(f.db, user, slug, { rulesVersion: 0, adult: true });
  await f.admin.query("update community_memberships set role = 'moderator' where community_id = $1 and user_id = 'b-mod'", [club]);
  general = (await listCategories(f.db, "b-owner", a, club))[0].id;
});
afterAll(async () => { await f?.close(); });

it("warns through the service, shows warnings only to the member, and counts them for hosts", async () => {
  const warning = await warnMember(f.db, "b-mod", slug, { userId: "b-one", reason: "  Please keep replies kind.  " });
  await expect(warnMember(f.db, "b-one", slug, { userId: "b-two", reason: "No" })).rejects.toMatchObject({ status: 403 });
  await expect(warnMember(f.db, "b-mod", slug, { userId: "b-owner", reason: "No" })).rejects.toMatchObject({ status: 403 });
  await expect(warnMember(f.db, "b-outsider", slug, { userId: "b-one", reason: "No" })).rejects.toMatchObject({ status: 404 });
  await expect(warnMember(f.db, "b-mod", slug, { userId: "b-one", reason: "   " })).rejects.toThrow();
  await expect(warnMember(f.db, "b-mod", slug, { userId: "b-one", reason: "x".repeat(501) })).rejects.toThrow();
  await expect(warnMember(f.db, "b-mod", slug, { userId: "b-one" })).rejects.toThrow();
  expect(await myWarnings(f.db, "b-one", slug)).toMatchObject([{ id: warning.id, reason: "Please keep replies kind." }]);
  expect(await myWarnings(f.db, "b-two", slug)).toEqual([]);
  expect(await myWarnings(f.db, "b-outsider", slug)).toEqual([]);
  expect((await moderationMembers(f.db, "b-owner", slug)).members.find((m) => m.userId === "b-one")?.warnings).toBe(1);
  await expect(acknowledgeWarning(f.db, "b-two", slug, warning.id!)).rejects.toMatchObject({ status: 404 });
  await acknowledgeWarning(f.db, "b-one", slug, warning.id!);
  await expect(acknowledgeWarning(f.db, "b-one", slug, warning.id!)).rejects.toMatchObject({ status: 404 });
  expect(await myWarnings(f.db, "b-one", slug)).toEqual([]);
  // Acknowledging does not erase the host-side count.
  expect((await moderationMembers(f.db, "b-owner", slug)).members.find((m) => m.userId === "b-one")?.warnings).toBe(1);
});

it("takes an appeal from a banned member, lists it for hosts, and lets an admin approve", async () => {
  await expect(submitAppeal(f.db, "b-two", { slug, message: "I am not banned" })).rejects.toMatchObject({ status: 404 });
  await moderateMember(f.db, "b-owner", slug, { userId: "b-two", action: "ban" });
  expect(await myBans(f.db, "b-two")).toMatchObject([{ slug, name: "Mod B forum", banned: true, canAppeal: true, appeal: null }]);
  await expect(submitAppeal(f.db, "b-two", { slug, message: "   " })).rejects.toThrow();
  await expect(submitAppeal(f.db, "b-two", { slug: "Bad Slug", message: "Sorry" })).rejects.toThrow();
  const sent = await submitAppeal(f.db, "b-two", { slug, message: "I am sorry." });
  await expect(submitAppeal(f.db, "b-two", { slug, message: "Again" })).rejects.toMatchObject({ status: 409 });
  expect(await moderationCount(f.db, "b-owner", slug)).toBe(1);
  const { items } = await moderationAppeals(f.db, "b-mod", slug);
  expect(items).toMatchObject([{ id: sent.id, userId: "b-two", name: "Name b-two", message: "I am sorry.", status: "open" }]);
  for (const user of ["b-one", "b-two", "b-outsider"]) await expect(moderationAppeals(f.db, user, slug)).rejects.toMatchObject({ status: 404 });
  await expect(decideAppeal(f.db, "b-one", slug, { appealId: sent.id, decision: "decline" })).rejects.toMatchObject({ status: 403 });
  await expect(decideAppeal(f.db, "b-mod", slug, { appealId: sent.id, decision: "approve" })).rejects.toMatchObject({ status: 403 });
  await expect(decideAppeal(f.db, "b-owner", slug, { appealId: sent.id, decision: "approve", reply: "x".repeat(501) })).rejects.toThrow();
  await decideAppeal(f.db, "b-owner", slug, { appealId: sent.id, decision: "approve", reply: "Welcome back." });
  expect(await myBans(f.db, "b-two")).toMatchObject([{ banned: false, canAppeal: false, appeal: { status: "approved", reply: "Welcome back." } }]);
  expect((await moderationAppeals(f.db, "b-owner", slug)).items[0]).toMatchObject({ status: "approved", reply: "Welcome back.", decidedByName: "Name b-owner" });
  expect(await moderationCount(f.db, "b-owner", slug)).toBe(0);
  // Approval is an unban: the person can rejoin through the normal way in.
  await enterCommunity(f.db, "b-two", slug, { rulesVersion: 0, adult: true });
});

it("shows hosts the previous versions of an edited post and reply, and nobody else", async () => {
  const target = await post("b-one", "First draft", "Original title");
  await post("b-one", "Second draft", "Edited title", target.id!);
  await post("b-one", "Third draft", "Edited title", target.id!);
  const answer = await saveComment(f.db, "b-two", slug, target.id!, { body: "Amen" });
  await saveComment(f.db, "b-two", slug, target.id!, { body: "Amen, brothers" }, answer.id!);
  const posts = (await editHistory(f.db, "b-mod", slug, { targetType: "post", targetId: target.id })).versions;
  expect(posts.map((v) => [v.title, v.current])).toEqual([["Edited title", true], ["Edited title", false], ["Original title", false]]);
  expect(JSON.stringify(posts[2].body)).toContain("First draft");
  expect(JSON.stringify(posts[1].body)).toContain("Second draft");
  const replies = (await editHistory(f.db, "b-owner", slug, { targetType: "comment", targetId: answer.id })).versions;
  expect(replies.map((v) => [v.text, v.current])).toEqual([["Amen, brothers", true], ["Amen", false]]);
  for (const user of ["b-one", "b-two", "b-outsider"]) {
    await expect(editHistory(f.db, user, slug, { targetType: "post", targetId: target.id })).rejects.toMatchObject({ status: 404 });
    await expect(editHistory(f.db, user, slug, { targetType: "comment", targetId: answer.id })).rejects.toMatchObject({ status: 404 });
  }
  await expect(editHistory(f.db, "b-mod", slug, { targetType: "post", targetId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
  await expect(editHistory(f.db, "b-mod", slug, { targetType: "page", targetId: target.id })).rejects.toThrow();
  // Members still see the post normally and cannot read revisions through the post page.
  const seen = await getPost(f.db, "b-two", slug, target.id!);
  expect(JSON.stringify(seen)).not.toContain("First draft");
});
