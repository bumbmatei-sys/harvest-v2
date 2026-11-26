import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { catalogItems, communityProductLinks, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity, leaveCommunity } from "../../src/server/community-joining";
import { createCatalogItem, enrolInCatalogItem, getCatalogContent, listCommunityShelf, setCatalogState, setCommunityProductLink } from "../../src/server/free-catalog";
import { communityShelf } from "../../src/server/community-shelf";
import { withUser } from "../../src/server/tenancy";

// C13 classroom and C16 products shelf: owners choose which published items a community shows; members read only that, and a link grants nothing.
const people = ["shelf-owner", "shelf-viewer", "shelf-member", "shelf-leaver", "shelf-outsider", "shelf-other"];
const [owner, viewer, member, leaver, outsider, other] = people;
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, foreignTenant: string, circle: string, quiet: string, foreignCircle: string;
let course: string, spare: string, download: string, hiddenDraft: string, foreignCourse: string;
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };
const courseInput = (slug: string, title: string) => ({ kind: "course", slug, title, visibility: "unlisted", lessons: [{ title: "One", body, published: true }] });
const notFound = { status: 404 };

async function publish(user: string, workspace: string, id: string) { await setCatalogState(f.db, user, workspace, id, { version: 1, state: "published" }); }
async function open(workspace: string, id: string, user: string) {
  const { version } = await getCommunity(f.db, user, workspace, id);
  const updated = await updateCommunity(f.db, user, workspace, id, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, user, workspace, id, { version: updated.version, published: true });
}

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Shelf Ministry", "church")).tenantId;
  foreignTenant = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, `${viewer}@example.test`, "viewer");
  circle = (await createCommunity(f.db, owner, tenant, { name: "Shelf circle", slug: "shelf-circle" })).id;
  quiet = (await createCommunity(f.db, owner, tenant, { name: "Quiet circle", slug: "quiet-circle" })).id;
  foreignCircle = (await createCommunity(f.db, other, foreignTenant, { name: "Foreign circle", slug: "foreign-shelf" })).id;
  for (const id of [circle, quiet]) await open(tenant, id, owner);
  await open(foreignTenant, foreignCircle, other);
  for (const user of [member, leaver]) await enterCommunity(f.db, user, "shelf-circle", { rulesVersion: 0, adult: true });
  await enterCommunity(f.db, member, "quiet-circle", { rulesVersion: 0, adult: true });

  course = (await createCatalogItem(f.db, owner, tenant, courseInput("shelf-course", "Foundations"))).id;
  spare = (await createCatalogItem(f.db, owner, tenant, courseInput("spare-course", "Another course"))).id;
  hiddenDraft = (await createCatalogItem(f.db, owner, tenant, courseInput("draft-course", "Unpublished course"))).id;
  foreignCourse = (await createCatalogItem(f.db, other, foreignTenant, courseInput("foreign-course", "Foreign course"))).id;
  const fileId = randomUUID();
  await f.admin.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status)
    values ($1,$2,$3,'workspaces/'||$2::uuid::text||'/files/'||$1::uuid::text,'guide.pdf','application/pdf',8,repeat('a',64),'ready')`, [fileId, tenant, owner]);
  download = (await createCatalogItem(f.db, owner, tenant, { kind: "download", slug: "shelf-guide", title: "Prayer guide", visibility: "listed", fileIds: [fileId] })).id;
  for (const id of [course, spare, download]) await publish(owner, tenant, id);
  await publish(other, foreignTenant, foreignCourse);
  await setCommunityProductLink(f.db, owner, tenant, circle, course, { position: 1 });
  await setCommunityProductLink(f.db, owner, tenant, circle, download, { position: 0 });
  await setCommunityProductLink(f.db, owner, tenant, quiet, spare, { position: 0 });
});
afterAll(async () => { await f?.close(); });

it("gives owners every published item with this community's links, and nothing else", async () => {
  const shelf = await listCommunityShelf(f.db, owner, tenant, circle);
  expect(shelf.map(({ title, kind, linked }) => ({ title, kind, linked }))).toEqual([
    { title: "Another course", kind: "course", linked: false }, { title: "Foundations", kind: "course", linked: true }, { title: "Prayer guide", kind: "download", linked: true },
  ]);
  expect(shelf.some((item) => item.id === hiddenDraft)).toBe(false);
  // A ministry viewer has no catalogue rights: the same items, none shown as linked, and the link route refuses them.
  expect((await listCommunityShelf(f.db, viewer, tenant, circle)).every((item) => !item.linked)).toBe(true);
  await expect(setCommunityProductLink(f.db, viewer, tenant, circle, spare, { position: 0 })).rejects.toMatchObject(notFound);
  for (const [user, workspace, id] of [[owner, tenant, foreignCircle], [other, foreignTenant, circle], [outsider, tenant, circle], [owner, tenant, "not-a-uuid"]] as const)
    await expect(listCommunityShelf(f.db, user, workspace, id)).rejects.toMatchObject(notFound);
  await expect(setCommunityProductLink(f.db, owner, tenant, circle, foreignCourse, { position: 0 })).rejects.toMatchObject(notFound);
});

it("shows members the classroom and products of their community only, without granting access", async () => {
  const classroom = await communityShelf(f.db, member, "shelf-circle", "course");
  expect(classroom?.items).toEqual([{ id: course, kind: "course", slug: "shelf-course", title: "Foundations", summary: "", enrolled: false }]);
  expect((await communityShelf(f.db, member, "shelf-circle", "download"))?.items.map((item) => item.slug)).toEqual(["shelf-guide"]);
  expect((await communityShelf(f.db, member, "quiet-circle", "course"))?.items.map((item) => item.slug)).toEqual(["spare-course"]);
  expect((await communityShelf(f.db, owner, "shelf-circle", "course"))?.items.map((item) => item.slug)).toEqual(["shelf-course"]);
  for (const user of [outsider, viewer, other]) expect(await communityShelf(f.db, user, "shelf-circle", "course")).toBeNull();
  expect(await communityShelf(f.db, member, "foreign-shelf", "course")).toBeNull();
  // The link is a pointer: the member enrols like anyone else, and only then sees the content and the enrolled state.
  await expect(getCatalogContent(f.db, member, "shelf-course")).rejects.toMatchObject(notFound);
  await enrolInCatalogItem(f.db, member, "shelf-course");
  expect((await communityShelf(f.db, member, "shelf-circle", "course"))?.items[0]).toMatchObject({ enrolled: true });
  expect((await communityShelf(f.db, leaver, "shelf-circle", "course"))?.items[0]).toMatchObject({ enrolled: false });
});

it("keeps raw SQL to the caller's own communities and to published shelf items", async () => {
  const seen = await withUser(f.db, member, (tx) => tx.select({ id: catalogItems.id }).from(catalogItems));
  expect(seen.map((row) => row.id).sort()).toEqual([course, spare, download].sort());
  const links = await withUser(f.db, leaver, (tx) => tx.select({ community: communityProductLinks.communityId }).from(communityProductLinks));
  expect(links.every((row) => row.community === circle)).toBe(true);
  for (const user of [outsider, other]) {
    expect(await withUser(f.db, user, (tx) => tx.select().from(catalogItems))).toEqual([]);
    expect(await withUser(f.db, user, (tx) => tx.select().from(communityProductLinks))).toEqual([]);
  }
  await expect(withUser(f.db, member, (tx) => tx.insert(communityProductLinks).values({ tenantId: tenant, communityId: circle, itemId: spare }))).rejects.toThrow();
  await expect(withUser(f.db, member, (tx) => tx.update(catalogItems).set({ title: "Changed" }).returning())).resolves.toEqual([]);
  expect((await f.admin.query(`select policyname, roles::text[] as roles, cmd from pg_policies where schemaname='public'
    and policyname in ('community_shelf_member','catalog_community_shelf') order by policyname`)).rows).toEqual([
    { policyname: "catalog_community_shelf", roles: ["harvest_app"], cmd: "SELECT" }, { policyname: "community_shelf_member", roles: ["harvest_app"], cmd: "SELECT" },
  ]);
});

it("drops items that are archived or unlinked and ends a leaver's view", async () => {
  await leaveCommunity(f.db, leaver, "shelf-circle", {});
  expect(await communityShelf(f.db, leaver, "shelf-circle", "course")).toBeNull();
  expect(await withUser(f.db, leaver, (tx) => tx.select().from(communityProductLinks))).toEqual([]);
  await setCatalogState(f.db, owner, tenant, download, { version: 2, state: "archived" });
  expect((await communityShelf(f.db, member, "shelf-circle", "download"))?.items).toEqual([]);
  await setCommunityProductLink(f.db, owner, tenant, circle, course, undefined, true);
  expect((await communityShelf(f.db, member, "shelf-circle", "course"))?.items).toEqual([]);
  // A separate enrolment survives the unlink.
  await expect(getCatalogContent(f.db, member, "shelf-course")).resolves.toMatchObject({ title: "Foundations" });
});
