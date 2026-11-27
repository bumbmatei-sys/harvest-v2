import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users, catalogItems, catalogLessonAttachments } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity, leaveCommunity } from "../../src/server/community-joining";
import { createCatalogItem, enrolInCatalogItem, getCatalogDraft, getPublicCatalogItem, setCatalogPublication, setCatalogState, setCommunityProductLink } from "../../src/server/free-catalog";
import { courseResources, downloadCourseResource, editorCatalogCover, publicCatalogCover, publicCatalogDirectory } from "../../src/server/catalog-assets";
import { changeListing } from "../../src/server/discover/owner";
import { decideReview } from "../../src/server/discover/platform";
import { searchDiscover } from "../../src/server/discover/public";
import { withTenant, withUser } from "../../src/server/tenancy";

const owner = "assets-owner", other = "assets-other", member = "assets-member", nonmember = "assets-nonmember", admin = "assets-admin";
const deps = { enabled: true, now: () => new Date() };
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Lesson" }] }] };
const lesson = { title: "Lesson", body, published: true };
const missing = { status: 404 };
const filename = "synthetic.pdf";
const secret = "local-integration-resource-grant";
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, outside: string, circle: string, fileId: string, coverId: string, foreignFile: string, unready: string;
let publicId: string, privateId: string, unlistedId: string, draftId: string, productId: string;
const bytes = new TextEncoder().encode("12345678");
const open = vi.fn(async () => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }));

async function file(scope: string, user: string, name: string, mime: string, status = "ready") {
  const id = randomUUID();
  await f.admin.query("insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum,status) values($1,$2,$3,$4,$5,$6,8,repeat('a',64),$7)",
    [id, scope, user, `workspaces/${scope}/files/${id}`, name, mime, status]);
  return id;
}
async function course(slug: string, visibility: string, published = true, content = [lesson], coverFileId?: string) {
  const item = await createCatalogItem(f.db, owner, tenant, { kind: "course", title: slug, slug, visibility, lessons: content, coverFileId });
  if (published) await setCatalogState(f.db, owner, tenant, item.id, { version: item.version, state: "published" });
  return item.id;
}
async function review(id: string, type: "course" | "product") {
  const control = async () => (await f.admin.query("select version from discover_controls where resource_id=$1", [id])).rows[0].version;
  const version = await control();
  await expect(changeListing(f.db, admin, tenant, type, id, { optIn: true, version }, deps)).rejects.toThrow();
  await changeListing(f.db, owner, tenant, type, id, { optIn: true, version }, deps);
  expect(await decideReview(f.workerPool, { tenantId: tenant, type, id, version: await control(), reviewer: other }, { decision: "approve" })).toBe("approved");
}
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values([owner, other, member, nonmember, admin].map(id => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Resource Ministry", "church")).tenantId;
  outside = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, `${nonmember}@example.invalid`, "member");
  await putMember(f.db, owner, tenant, `${admin}@example.invalid`, "admin");
  circle = (await createCommunity(f.db, owner, tenant, { name: "Resource circle", slug: "resource-circle" })).id;
  const current = await getCommunity(f.db, owner, tenant, circle);
  const next = await updateCommunity(f.db, owner, tenant, circle, { version: current.version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, owner, tenant, circle, { version: next.version, published: true });
  await enterCommunity(f.db, member, "resource-circle", { rulesVersion: 0, adult: true });
  fileId = await file(tenant, owner, filename, "application/pdf");
  coverId = await file(tenant, owner, "cover.png", "image/png");
  foreignFile = await file(outside, other, "foreign.pdf", "application/pdf");
  unready = await file(tenant, owner, "pending.pdf", "application/pdf", "uploaded");
  const attachments = [
    { ...lesson, attachmentFileIds: [fileId] },
    { ...lesson, title: "Private lesson", published: false, attachmentFileIds: [fileId] },
  ];
  publicId = await course("public-course", "public", true, attachments, coverId);
  privateId = await course("member-course", "community", true, attachments);
  unlistedId = await course("link-only-course", "unlisted");
  draftId = await course("draft-only-course", "public", false, [lesson], coverId);
  await setCommunityProductLink(f.db, owner, tenant, circle, privateId, { position: 0 });
  const product = await createCatalogItem(f.db, owner, tenant, { kind: "download", slug: "public-product", title: "Public product", visibility: "public", fileIds: [fileId], coverFileId: coverId });
  productId = product.id;
  await setCatalogState(f.db, owner, tenant, productId, { version: product.version, state: "published" });
}, 120_000);
afterAll(async () => { await f?.close(); });

it("enforces all four visibility levels on exact links, staff access and raw rows", async () => {
  for (const actor of [undefined, member, nonmember, owner, other]) {
    await expect(getPublicCatalogItem(f.db, "public-course", actor)).resolves.toMatchObject({ priceLabel: "Free", hasCover: true });
    await expect(getPublicCatalogItem(f.db, "link-only-course", actor)).resolves.toMatchObject({ slug: "link-only-course" });
    await expect(getPublicCatalogItem(f.db, "draft-only-course", actor)).rejects.toMatchObject(missing);
  }
  for (const actor of [undefined, nonmember, other]) await expect(getPublicCatalogItem(f.db, "member-course", actor)).rejects.toMatchObject(missing);
  for (const actor of [member, owner]) await expect(getPublicCatalogItem(f.db, "member-course", actor)).resolves.toMatchObject({ slug: "member-course" });
  await expect(getCatalogDraft(f.db, owner, tenant, draftId)).resolves.toMatchObject({ state: "draft" });
  const raw = (actor: string) => withUser(f.db, actor, tx => tx.select({ id: catalogItems.id }).from(catalogItems));
  expect((await raw(member)).map(r => r.id)).toEqual([privateId]);
  expect(await raw(other)).toEqual([]);
  const visible = await withTenant(f.db, nonmember, tenant, "workspace:read", async tx => tx.select({ id: catalogItems.id }).from(catalogItems));
  expect(visible.map(r => r.id).sort()).toEqual([publicId, unlistedId, productId].sort());
  await expect(withUser(f.db, other, async tx => {
    await tx.execute(sql`select set_config('app.catalog_tenant', ${tenant}, true),set_config('app.access_token','forged',true)`);
    return tx.select().from(catalogLessonAttachments);
  })).resolves.toEqual([]);
});

it("exposes only published attachments to an entitled learner and checks signed expiry and recipient", async () => {
  await expect(courseResources(f.db, member, "member-course", secret)).rejects.toMatchObject(missing);
  await expect(courseResources(f.db, owner, "member-course", secret)).rejects.toMatchObject(missing);
  await enrolInCatalogItem(f.db, member, "member-course");
  const now = 100_000;
  const { items, expiresIn } = await courseResources(f.db, member, "member-course", secret, now);
  expect(expiresIn).toBe(60);
  expect(items).toEqual([expect.objectContaining({ fileId, name: filename, lessonTitle: "Lesson" })]);
  expect(JSON.stringify(items)).not.toContain("workspaces/");
  const [{ lessonId, downloadHref }] = items;
  const token = new URL(downloadHref, "https://app.example.invalid").searchParams.get("grant");
  const stream = await downloadCourseResource(f.db, member, "member-course", lessonId, fileId, token, open, secret, now + 59);
  expect(stream.headers.get("content-disposition")).toContain(filename);
  expect(await stream.text()).toBe("12345678");
  await expect(downloadCourseResource(f.db, member, "member-course", lessonId, fileId, token, open, secret, now + 60)).rejects.toMatchObject(missing);
  await expect(downloadCourseResource(f.db, nonmember, "member-course", lessonId, fileId, token, open, secret, now)).rejects.toMatchObject(missing);
  await leaveCommunity(f.db, member, "resource-circle", {});
  await expect(downloadCourseResource(f.db, member, "member-course", lessonId, fileId, token, open, secret, now)).rejects.toMatchObject(missing);
});

it("reuses ready private images for courses and products, and rejects other or unverified files", async () => {
  for (const slug of ["public-course", "public-product"]) {
    expect((await publicCatalogCover(f.db, "", slug, open)).headers.get("content-type")).toBe("image/png");
  }
  await expect(publicCatalogCover(f.db, "", "draft-only-course", open)).rejects.toMatchObject(missing);
  expect((await editorCatalogCover(f.db, owner, tenant, draftId, open)).headers.get("content-type")).toBe("image/png");
  for (const coverFileId of [fileId, unready, foreignFile]) {
    await expect(setCatalogPublication(f.db, owner, tenant, publicId, { version: 2, coverFileId })).rejects.toMatchObject(missing);
  }
  await expect(createCatalogItem(f.db, owner, tenant, { kind: "course", title: "Bad asset", slug: "bad-asset",
    lessons: [{ ...lesson, attachmentFileIds: [unready] }] })).rejects.toMatchObject(missing);
});

it("requires reviewed owner opt-in, lists author and free price data, and pages per ministry", async () => {
  expect(await publicCatalogDirectory(f.db, tenant, {})).toEqual({ items: [], next: null });
  await review(publicId, "course");
  await review(productId, "product");
  const first = await publicCatalogDirectory(f.db, tenant, { limit: 1, author: owner });
  expect(first).toMatchObject({ items: [{ author: { id: owner, name: owner }, priceLabel: "Free", coverHref: expect.any(String) }], next: expect.any(String) });
  const second = await publicCatalogDirectory(f.db, tenant, { limit: 1, after: first.next, author: owner });
  expect(second.next).toBeNull();
  expect([...first.items, ...second.items].map(item => item.id).sort()).toEqual([publicId, productId].sort());
  expect(await publicCatalogDirectory(f.db, outside, {})).toEqual({ items: [], next: null });
  expect(await publicCatalogDirectory(f.db, tenant, { author: other })).toEqual({ items: [], next: null });
  await f.admin.query("update catalog_items set state='draft' where id=$1", [publicId]);
  expect((await publicCatalogDirectory(f.db, tenant, {})).items.map(i => i.id)).toEqual([productId]);
  expect((await searchDiscover(f.db, new URLSearchParams({ type: "course" }), deps)).items).toEqual([]);
});
