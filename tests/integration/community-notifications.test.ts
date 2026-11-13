import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity, getCommunity, updateCommunity } from "../../src/server/communities";
import { decideApplication } from "../../src/server/community-applications";
import { forumContext, saveComment, savePost, toggleLike } from "../../src/server/community-forum";
import { dismissWelcome, listNotifications, markRead, savePreferences, unreadCount } from "../../src/server/community-notifications";

// C15a services: bell list, unread count, mark read, preferences, welcome card, application decision notices.
let f: Awaited<ReturnType<typeof testDatabase>>, a: string, club: string, general: string;
const people = ["s-owner", "s-author", "s-replier", "s-applicant", "s-outsider"];
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] };

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "s-owner", "Grace Church", "church")).tenantId;
  club = (await createCommunity(f.db, "s-owner", a, { name: "Service club", slug: "service-club" })).id;
  await f.admin.query("update communities set status = 'published' where id = $1", [club]);
  for (const user of ["s-author", "s-replier"]) {
    await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status, joined_at) values ($1, $2, $3, 'member', 'active', now())", [a, club, user]);
    await f.admin.query("insert into entitlements (tenant_id, user_id, resource_type, resource_id, source) values ($1, $2, 'community', $3, 'admin_grant')", [a, user, club]);
  }
  general = (await f.admin.query("select id from community_categories where community_id = $1", [club])).rows[0].id;
});
afterAll(async () => { await f?.close(); });

it("lists notifications, counts unread, marks read and honours preferences", async () => {
  const p = await savePost(f.db, "s-author", "service-club", { categoryId: general, title: "Prayer", body });
  await saveComment(f.db, "s-replier", "service-club", p.id!, { body: "Amen" });
  await toggleLike(f.db, "s-replier", "service-club", { targetType: "post", targetId: p.id });
  expect(await unreadCount(f.db, "s-author", "service-club")).toBe(2);
  const { items, unread } = await listNotifications(f.db, "s-author", "service-club");
  expect(unread).toBe(2);
  expect(items.map((i) => i.kind).sort()).toEqual(["like", "reply"]);
  expect(items[0].actorName).toBe("s-replier");
  await markRead(f.db, "s-author", "service-club", { ids: [items[0].id] });
  expect(await unreadCount(f.db, "s-author", "service-club")).toBe(1);
  await markRead(f.db, "s-author", "service-club", { ids: null });
  expect(await unreadCount(f.db, "s-author", "service-club")).toBe(0);
  await expect(markRead(f.db, "s-author", "service-club", { ids: ["nope"] })).rejects.toThrow();
  await savePreferences(f.db, "s-author", "service-club", { replies: false, likes: true, announcements: true, muted: false });
  await saveComment(f.db, "s-replier", "service-club", p.id!, { body: "More" });
  expect(await unreadCount(f.db, "s-author", "service-club")).toBe(0);
  expect((await forumContext(f.db, "s-author", "service-club"))!.prefs).toEqual({ replies: false, likes: true, announcements: true, muted: false });
  await expect(savePreferences(f.db, "s-author", "service-club", { replies: false })).rejects.toThrow();
  for (const call of [() => listNotifications(f.db, "s-outsider", "service-club"), () => unreadCount(f.db, "s-outsider", "service-club"), () => savePreferences(f.db, "s-outsider", "service-club", { replies: true, likes: true, announcements: true, muted: false })])
    await expect(call()).rejects.toMatchObject({ status: 404 });
});

it("stores the welcome message and introductions category, then dismisses the card once", async () => {
  const edit = async (changes: Record<string, unknown>) => updateCommunity(f.db, "s-owner", a, club, { version: (await getCommunity(f.db, "s-owner", a, club)).version, ...changes });
  const other = (await f.admin.query("insert into community_categories (tenant_id, community_id, name, position) select $1, $2, 'Hello', 1 returning id", [a, club])).rows[0].id;
  await edit({ welcomeMessage: "  Welcome, friend.  ", introCategoryId: other });
  const before = await forumContext(f.db, "s-replier", "service-club");
  expect(before!.welcome).toEqual({ message: "Welcome, friend.", introCategoryId: other, dismissed: false });
  await expect(edit({ welcomeMessage: "x".repeat(1001) })).rejects.toThrow();
  await expect(edit({ introCategoryId: crypto.randomUUID() })).rejects.toMatchObject({ status: 400 });
  await dismissWelcome(f.db, "s-replier", "service-club");
  expect((await forumContext(f.db, "s-replier", "service-club"))!.welcome.dismissed).toBe(true);
  expect((await forumContext(f.db, "s-author", "service-club"))!.welcome.dismissed).toBe(false);
  await edit({ welcomeMessage: null, introCategoryId: null });
  expect((await forumContext(f.db, "s-author", "service-club"))!.welcome).toMatchObject({ message: null, introCategoryId: null });
});

it("notifies applicants of decisions through the staff path", async () => {
  const [{ id: application }] = (await f.admin.query("insert into community_applications (tenant_id, community_id, user_id, status, answers, questions_version, rules_version, adult_confirmed_at) values ($1, $2, 's-applicant', 'pending', '{}'::jsonb, 0, 0, now()) returning id", [a, club])).rows;
  await decideApplication(f.db, "s-owner", a, club, application, { action: "request_info", message: "Tell us more" });
  await decideApplication(f.db, "s-owner", a, club, application, { action: "approve" });
  const rows = (await f.admin.query("select kind, detail, actor_id from community_notifications where recipient_id = 's-applicant' order by created_at")).rows;
  expect(rows.map((r) => r.detail.status)).toEqual(["info_requested", "approved"]);
  expect(rows.every((r) => r.kind === "application" && r.actor_id === "s-owner")).toBe(true);
  // Now a member: the bell shows the approval.
  expect((await listNotifications(f.db, "s-applicant", "service-club")).items.map((i) => i.kind)).toEqual(["application", "application"]);
});
