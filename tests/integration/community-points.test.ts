import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { GET, POST } from "../../src/app/api/workspaces/[tenantId]/communities/[communityId]/points/route";
import { users } from "../../src/db/schema";
import { createCommunity, listCategories, publishCommunity, updateCommunity } from "../../src/server/communities";
import { deletePost, saveComment, savePost } from "../../src/server/community-forum";
import { enterCommunity } from "../../src/server/community-joining";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({ getDb: () => fixture.db }));
vi.mock("@/server/http", async (actual) => ({
  ...await actual<typeof import("../../src/server/http")>(),
  verifyOrigin: () => {},
  verifiedUser: async (request: Request) => request.headers.get("x-test-user"),
}));

const owner = "points-owner", member = "points-member", other = "points-other";
const slug = "points-community";
let tenantId: string, communityId: string, categoryId: string, elsewhere: string;
const server = (actor: string, input?: object, period = "all", tenant = tenantId) => {
  const request = new Request("http://localhost/points?period=" + period, {
    method: input ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-test-user": actor },
    body: input ? JSON.stringify(input) : undefined,
  });
  return (input ? POST : GET)(request, { params: Promise.resolve({ tenantId: tenant, communityId }) });
};
const report = async (actor = member, period = "all") => {
  const response = await server(actor, undefined, period);
  expect(response.status).toBe(200);
  return response.json();
};
const action = async (actor: string, name: string, input: object) => {
  const response = await server(actor, { action: name, input });
  expect(response.status).toBe(200);
  return response.json();
};
const post = async (title: string) => {
  const saved = await savePost(fixture.db, member, slug, { categoryId, title, body: {
    type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: title }] }],
  } });
  return saved.id as string;
};
const date = (days: number) => new Date(Date.now() + 86_400_000 * days).toISOString();

beforeAll(async () => {
  fixture = await testDatabase({ migrationOwner: true });
  await fixture.db.insert(users).values([owner, member, other].map((id) => ({ id, name: id, email: id + "@example.invalid", emailVerified: true })));
  tenantId = (await createWorkspace(fixture.db, owner, "Example ministry", "church")).tenantId;
  elsewhere = (await createWorkspace(fixture.db, other, "Other ministry", "church")).tenantId;
  const draft = await createCommunity(fixture.db, owner, tenantId, { name: "Example community", slug });
  communityId = draft.id;
  const ready = await updateCommunity(fixture.db, owner, tenantId, communityId, { version: draft.version, visibility: "listed", allowOpen: true });
  await publishCommunity(fixture.db, owner, tenantId, communityId, { version: ready.version, published: true });
  await enterCommunity(fixture.db, member, slug, { adult: true, rulesVersion: 0 });
  categoryId = (await listCategories(fixture.db, owner, tenantId, communityId))[0].id;
}, 120_000);
afterAll(async () => { await fixture?.close(); });

it("authorizes community members only and checks the host role for settings", async () => {
  expect((await server(other)).status).toBe(404);
  expect((await server(member, undefined, "all", elsewhere)).status).toBe(404);
  expect((await report()).settings).toEqual({ enabled: false, post: 5, reply: 2, lesson: 10, event: 15, thresholds: [25, 100, 250] });
  const settings = { enabled: true, post: 5, reply: 2, lesson: 10, event: 15, thresholds: [5, 15, 30] };
  expect((await server(member, { action: "settings", input: settings })).status).toBe(404);
  await action(owner, "settings", settings);
  expect((await report()).settings).toEqual(settings);
});

it("counts unique visible activity, recent windows, and an enrolled member's challenge", async () => {
  const { id: challengeId } = await action(owner, "create", { title: "Write a post", goal: "post", target: 1,
    startsAt: date(-1), endsAt: date(1) });
  await action(member, "join", { challengeId });
  await action(member, "join", { challengeId });
  const current = await post("Current post");
  await saveComment(fixture.db, member, slug, current, { body: "Example reply" });
  const older = await post("Older post");
  await fixture.admin.query("update community_posts set created_at = $2 where id = $1", [older, date(-10)]);
  const oldest = await post("Oldest post");
  await fixture.admin.query("update community_posts set created_at = $2 where id = $1", [oldest, date(-31)]);
  expect((await report(member, "7")).leaderboard).toEqual([{ userId: member, points: 7, level: 3 }]);
  expect((await report(member, "30")).leaderboard).toEqual([{ userId: member, points: 12, level: 3 }]);
  const all = await report();
  expect(all.leaderboard).toEqual([{ userId: member, points: 17, level: 3 }]);
  const completion = all.challenges.find(({ id }: { id: string }) => id === challengeId);
  expect(completion).toMatchObject({ progress: 1, completedAt: expect.any(String) });
  expect((await report(owner)).challenges.find(({ id }: { id: string }) => id === challengeId)).toMatchObject({ progress: 0, completedAt: null });
  await deletePost(fixture.db, member, slug, current);
  expect((await report(member, "7")).leaderboard).toEqual([]);
  expect((await report()).challenges.find(({ id }: { id: string }) => id === challengeId)).toMatchObject({ progress: 0, completedAt: completion.completedAt });
  await action(owner, "hide", { userId: member, hidden: true });
  expect((await report(owner)).leaderboard).toEqual([]);
  await action(owner, "hide", { userId: member, hidden: false });
});

it("counts community shelf completions and deduplicates host-confirmed attendance", async () => {
  const item = randomUUID(), section = randomUUID(), lesson = randomUUID(), event = randomUUID();
  const db = fixture.admin;
  await db.query("insert into catalog_items(tenant_id,id,kind,slug,title,state) values($1,$2,'course','points-course','Example course','published')", [tenantId, item]);
  await db.query("insert into catalog_sections(tenant_id,item_id,id,position,title) values($1,$2,$3,0,'Example section')", [tenantId, item, section]);
  await db.query("insert into catalog_lessons(tenant_id,item_id,id,section_id,position,title,body,published) values($1,$2,$3,$4,0,'Lesson','{}',true)",
    [tenantId, item, lesson, section]);
  await db.query("insert into catalog_progress(tenant_id,item_id,lesson_id,user_id) values($1,$2,$3,$4)", [tenantId, item, lesson, member]);
  await db.query("insert into community_product_links(tenant_id,community_id,item_id,kind) values($1,$2,$3,'course')", [tenantId, communityId, item]);
  await db.query("insert into events(tenant_id,id,title,time_zone,starts_at,ends_at,status) values($1,$2,'Example event','UTC',$3,$4,'published')",
    [tenantId, event, date(-1), date(-0.5)]);
  await db.query("insert into community_event_links(tenant_id,event_id,community_id) values($1,$2,$3)", [tenantId, event, communityId]);
  const attendance = { userId: member, eventId: event, attended: true };
  expect((await server(member, { action: "attendance", input: attendance })).status).toBe(404);
  await action(owner, "attendance", attendance);
  await action(owner, "attendance", attendance);
  expect((await report(member, "7")).leaderboard).toMatchObject([{ userId: member, points: 25 }]);
  await db.query("update catalog_lessons set published=false where tenant_id=$1 and id=$2", [tenantId, lesson]);
  expect((await report(member, "7")).leaderboard).toMatchObject([{ userId: member, points: 15 }]);
  await action(owner, "attendance", { ...attendance, attended: false });
  expect((await report(member, "7")).leaderboard).toEqual([]);
  await db.query("update community_memberships set status='banned' where tenant_id=$1 and community_id=$2 and user_id=$3", [tenantId, communityId, member]);
  expect((await server(member)).status).toBe(404);
  expect((await report(owner)).leaderboard).toEqual([]);
});
