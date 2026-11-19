import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { catalogEnrolments, catalogFiles, catalogLessons, communityProductLinks, entitlements, files, users } from "../../src/db/schema";
import { communityAccess, createCommunity } from "../../src/server/communities";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { withTenant } from "../../src/server/tenancy";
import {
  catalogDownload, createCatalogItem, enrolInCatalogItem, getCatalogContent, getCatalogDraft,
  getPublicCatalogItem, setCatalogState, setCommunityProductLink, updateCatalogItem,
} from "../../src/server/free-catalog";

const people = ["catalog-owner", "catalog-admin", "catalog-viewer", "catalog-member", "catalog-other", "catalog-learner"];
const [owner, admin, viewer, member, other, learner] = people;
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, foreignTenant: string, circle: string, foreignCircle: string;
const body = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Private lesson" }] }] };
const course = (slug: string) => ({ kind: "course", slug, title: "Free course", visibility: "unlisted",
  lessons: [{ title: "Published lesson", body, published: true }, { title: "Draft lesson", body, published: false }] });
const notFound = { status: 404 };
const legacyTenant = randomUUID(), legacyCircle = randomUUID();

beforeAll(async () => {
  f = await testDatabase({
    migrationOwner: true,
    async beforeChatMigration(db) {
      await db.query("insert into users (id,name,email) values ('legacy-owner','Owner','legacy-owner@example.test'), ('legacy-member','Member','legacy-member@example.test')");
      await db.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Legacy ministry','legacy-owner')", [legacyTenant]);
      await db.query("insert into communities (tenant_id,id,slug,name) values ($1,$2,'legacy-circle','Legacy circle')", [legacyTenant, legacyCircle]);
      await db.query("insert into community_memberships (tenant_id,community_id,user_id,status) values ($1,$2,'legacy-member','active')", [legacyTenant, legacyCircle]);
      await db.query("insert into entitlements (tenant_id,resource_type,resource_id,user_id,source) values ($1,'community',$2,'legacy-member','admin_grant')", [legacyTenant, legacyCircle]);
    },
  });
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: id+"@example.test", emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Catalog Ministry", "church")).tenantId;
  foreignTenant = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, admin+"@example.test", "admin");
  await putMember(f.db, owner, tenant, viewer+"@example.test", "viewer");
  await putMember(f.db, owner, tenant, member+"@example.test", "member");
  circle = (await createCommunity(f.db, owner, tenant, { name: "Course community", slug: "course-community" })).id;
  foreignCircle = (await createCommunity(f.db, other, foreignTenant, { name: "Foreign community", slug: "foreign-community" })).id;
});
afterAll(async () => { await f?.close(); });

it("separates metadata, authoring, anonymous publication and the enrolment grant", async () => {
  const input = course("bible-study");
  const draft = await createCatalogItem(f.db, admin, tenant, input);
  expect(await getCatalogDraft(f.db, owner, tenant, draft.id)).toMatchObject({ state: "draft", lessons: [{ body }, { body }] });
  for (const user of [viewer, member]) {
    expect(await getCatalogDraft(f.db, user, tenant, draft.id)).not.toHaveProperty("lessons");
    await expect(updateCatalogItem(f.db, user, tenant, draft.id, { draft: input, version: 1 })).rejects.toMatchObject(notFound);
    await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.select().from(catalogLessons))).resolves.toEqual([]);
  }
  await expect(getCatalogDraft(f.db, other, foreignTenant, draft.id)).rejects.toMatchObject(notFound);
  await expect(getPublicCatalogItem(f.db, input.slug)).rejects.toMatchObject(notFound);
  await expect(enrolInCatalogItem(f.db, learner, input.slug)).rejects.toMatchObject(notFound);
  await expect(setCatalogState(f.db, owner, tenant, draft.id, { version: 1, state: "published" })).resolves.toMatchObject({ version: 2 });
  await expect(getPublicCatalogItem(f.db, input.slug)).resolves.toEqual({ slug: input.slug, title: input.title, summary: "", kind: "course" });
  await expect(getCatalogContent(f.db, learner, input.slug)).rejects.toMatchObject(notFound);
  await expect(Promise.all([enrolInCatalogItem(f.db, learner, input.slug), enrolInCatalogItem(f.db, learner, input.slug)]))
    .resolves.toEqual([{ enrolled: true }, { enrolled: true }]);
  await expect(getCatalogContent(f.db, learner, input.slug)).resolves.toMatchObject({ lessons: [{ title: "Published lesson", body }], files: [] });
  for (const user of [viewer, member]) {
    await expect(getCatalogContent(f.db, user, input.slug)).rejects.toMatchObject(notFound);
    await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) =>
      tx.select().from(entitlements).where(eq(entitlements.resourceId, draft.id)))).resolves.toEqual([]);
    await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.select().from(catalogEnrolments))).rejects.toThrow();
  }
  expect((await f.admin.query("select count(*)::int n from catalog_enrolments where item_id=$1", [draft.id])).rows).toEqual([{ n: 1 }]);
  expect((await f.admin.query("select count(*)::int n from entitlements where catalog_item_id=$1", [draft.id])).rows).toEqual([{ n: 1 }]);
  expect((await f.admin.query("select count(*)::int n from workspace_members where user_id=$1", [learner])).rows).toEqual([{ n: 0 }]);
  expect((await f.admin.query("select metadata from audit_logs where target_id=$1 and action='catalog.enrol'", [draft.id])).rows).toEqual([{ metadata: {} }]);
  await setCatalogState(f.db, owner, tenant, draft.id, { version: 2, state: "archived" });
  await expect(getCatalogContent(f.db, learner, input.slug)).rejects.toMatchObject(notFound);
  await expect(getPublicCatalogItem(f.db, input.slug)).rejects.toMatchObject(notFound);
});

it("links the canonical published item to a same-ministry community without granting access", async () => {
  const input = course("linked-course");
  const item = await createCatalogItem(f.db, owner, tenant, input);
  await expect(setCommunityProductLink(f.db, owner, tenant, circle, item.id, { position: 3 })).rejects.toMatchObject(notFound);
  await setCatalogState(f.db, owner, tenant, item.id, { version: 1, state: "published" });
  await expect(setCommunityProductLink(f.db, owner, tenant, foreignCircle, item.id, { position: 3 })).rejects.toMatchObject(notFound);
  await expect(setCommunityProductLink(f.db, owner, tenant, circle, item.id, { position: 3 })).resolves.toEqual({ linked: true });
  await expect(getCatalogContent(f.db, owner, input.slug)).rejects.toMatchObject(notFound);
  await expect(withTenant(f.db, viewer, tenant, "workspace:read", (tx) => tx.select().from(communityProductLinks))).resolves.toEqual([]);
  await expect(f.admin.query("insert into community_product_links(tenant_id,community_id,item_id) values($1,$2,$3)",
    [tenant, foreignCircle, item.id])).rejects.toMatchObject({ code: "23503" });
  await expect(setCommunityProductLink(f.db, owner, tenant, circle, item.id, undefined, true)).resolves.toEqual({ linked: false });
});

it("checks ready private files at publication and at every signed download", async () => {
  const fileId = randomUUID(), foreignFile = randomUUID();
  await f.admin.query(`insert into files(id,tenant_id,owner_id,key,name,mime,size,checksum)
    values ($1,$2,$3,'workspaces/'||$2::uuid::text||'/files/'||$1::uuid::text,'lesson.pdf','application/pdf',8,repeat('a',64)),
           ($4,$5,$6,'workspaces/'||$5::uuid::text||'/files/'||$4::uuid::text,'other.pdf','application/pdf',8,repeat('b',64))`,
    [fileId, tenant, owner, foreignFile, foreignTenant, other]);
  const draft = { kind: "download", title: "Activity sheet", visibility: "listed", slug: "activity-sheet", fileIds: [fileId] };
  await expect(createCatalogItem(f.db, owner, tenant, { ...draft, fileIds: [foreignFile] })).rejects.toMatchObject(notFound);
  const item = await createCatalogItem(f.db, owner, tenant, draft);
  await expect(setCatalogState(f.db, owner, tenant, item.id, { version: 1, state: "published" })).rejects.toMatchObject({ status: 400 });
  await f.admin.query("update files set status='ready' where id=$1", [fileId]);
  await setCatalogState(f.db, owner, tenant, item.id, { version: 1, state: "published" });
  const storage = vi.fn(() => ({ presignDownload: vi.fn().mockResolvedValue("https://storage.example.test/download") }));
  await expect(catalogDownload(f.db, learner, draft.slug, fileId, storage)).rejects.toMatchObject(notFound);
  expect(storage).not.toHaveBeenCalled();
  await enrolInCatalogItem(f.db, learner, draft.slug);
  await expect(catalogDownload(f.db, learner, draft.slug, foreignFile, storage)).rejects.toMatchObject(notFound);
  await expect(catalogDownload(f.db, learner, draft.slug, fileId, storage)).resolves.toEqual({ url: "https://storage.example.test/download" });
  await f.admin.query("update files set status='quarantined' where id=$1", [fileId]);
  await expect(catalogDownload(f.db, learner, draft.slug, fileId, storage)).rejects.toMatchObject(notFound);
  await expect(withTenant(f.db, member, tenant, "workspace:read", (tx) => tx.select().from(catalogFiles))).resolves.toEqual([]);
  expect(storage).toHaveBeenCalledOnce();
  expect((await f.admin.query("select visibility from files where id=$1", [fileId])).rows[0].visibility).toBe("private");
  await expect(withTenant(f.db, owner, tenant, "workspace:read", (tx) => tx.select({ id: files.id }).from(files))).resolves.toContainEqual({ id: fileId });
});

it("forces RLS on every new table and denies raw cross-tenant operations", async () => {
  expect((await f.admin.query(`select relname from pg_class where relrowsecurity and relforcerowsecurity and
    (relname like 'catalog_%' or relname='community_product_links') order by relname`)).rows.map((row) => row.relname))
    .toEqual(["catalog_enrolments", "catalog_files", "catalog_items", "catalog_lessons", "community_product_links"]);
  expect((await f.admin.query(`select roles::text[] as roles from pg_policies
    where schemaname='public' and tablename='files' and policyname='catalog_resolver_file'`)).rows)
    .toEqual([{ roles: [f.migrationOwner] }]);
  const input = course("safe-content");
  const item = await createCatalogItem(f.db, owner, tenant, input);
  await expect(withTenant(f.db, other, foreignTenant, "workspace:read", (tx) =>
    tx.execute(sql`select * from catalog_items where id=${item.id}`))).resolves.toMatchObject({ rows: [] });
  await expect(updateCatalogItem(f.db, owner, tenant, item.id, { version: 2, draft: input })).rejects.toMatchObject({ status: 409 });
  await expect(updateCatalogItem(f.db, owner, tenant, item.id, { version: 1, draft: { ...input, lessons: [
    { title: "Script", published: true, body: { type: "doc", content: [{ type: "iframe" }] } },
  ] } })).rejects.toMatchObject({ name: "ZodError" });
});

it("preserves existing community grants when upgrading to the course and product grant model", async () => {
  expect(await communityAccess(f.db, "legacy-member", legacyCircle)).toEqual({
    allowed: true, role: "member", sources: ["admin_grant"],
  });
  expect((await f.admin.query("select catalog_item_id from entitlements where tenant_id=$1", [legacyTenant])).rows)
    .toEqual([{ catalog_item_id: null }]);
});
