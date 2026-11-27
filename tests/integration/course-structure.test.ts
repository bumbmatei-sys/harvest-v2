import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { catalogLessons, catalogLevels, catalogSections, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import {
  createCatalogItem, enrolInCatalogItem, getCatalogContent, getCatalogDraft, getPublicCatalogItem, setCatalogState, setCommunityProductLink, updateCatalogItem,
} from "../../src/server/free-catalog";
import { withTenant, withUser } from "../../src/server/tenancy";

// Courses follow-up slice 1 (0130): Level -> Section -> Lesson, the course's own labels, and a lesson video kept as provider and id only.
const people = ["cs-owner", "cs-admin", "cs-viewer", "cs-member", "cs-other", "cs-learner", "cs-circle-member"];
const [owner, admin, viewer, member, other, learner, circleMember] = people;
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, foreignTenant: string;
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const lesson = (title: string, extra: Record<string, unknown> = {}) => ({ title, body: body(title), published: true, ...extra });
const notFound = { status: 404 };
const structured = (slug: string) => ({
  kind: "course", slug, title: "Discipleship path", visibility: "unlisted", labels: { level: "Module", section: "Week", lesson: null },
  levels: [
    { title: "Foundations", sections: [
      { title: "Prayer", lessons: [lesson("Why pray", { videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s" }), lesson("How to pray")] },
      { title: "", lessons: [lesson("Draft only", { published: false })] },
    ] },
    { title: "", sections: [{ title: "Scripture", lessons: [lesson("Reading plan", { videoUrl: "https://vk.com/video_ext.php?oid=-22822305&id=456241864&hash=abc123" })] }] },
  ],
});
type Draft = { version: number; labels: unknown; lessons: { id: string; sectionId: string; title: string; video: unknown }[];
  sections: { id: string; levelId: string | null; title: string }[]; levels: { id: string; title: string }[] };
const read = async (id: string, user = owner) => (await getCatalogDraft(f.db, user, tenant, id)) as unknown as Draft;

async function openCommunity(id: string) {
  const { version } = await getCommunity(f.db, owner, tenant, id);
  const updated = await updateCommunity(f.db, owner, tenant, id, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, owner, tenant, id, { version: updated.version, published: true });
}

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Structure Ministry", "church")).tenantId;
  foreignTenant = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, `${admin}@example.invalid`, "admin");
  await putMember(f.db, owner, tenant, `${viewer}@example.invalid`, "viewer");
  await putMember(f.db, owner, tenant, `${member}@example.invalid`, "member");
});
afterAll(async () => { await f?.close(); });

it("stores levels, sections, labels and lesson videos in course order, for owners and admins only", async () => {
  const { id } = await createCatalogItem(f.db, admin, tenant, structured("structured-course"));
  const item = await read(id, admin);
  expect(item.labels).toEqual({ level: "Module", section: "Week", lesson: null });
  expect(item.levels.map((row) => row.title)).toEqual(["Foundations", ""]);
  expect(item.sections.map((row) => [row.title, item.levels.findIndex((level) => level.id === row.levelId)])).toEqual([["Prayer", 0], ["", 0], ["Scripture", 1]]);
  expect(item.lessons.map((row) => [row.title, item.sections.findIndex((section) => section.id === row.sectionId)]))
    .toEqual([["Why pray", 0], ["How to pray", 0], ["Draft only", 1], ["Reading plan", 2]]);
  expect(item.lessons.map((row) => row.video)).toEqual([
    { provider: "youtube", id: "dQw4w9WgXcQ" }, null, null, { provider: "vk", id: "-22822305_456241864_abc123" }]);
  // Only the provider and id reach the database: no link, host or query.
  const stored = (await f.admin.query("select video_provider, video_id from catalog_lessons where item_id = $1 order by position", [id])).rows;
  expect(JSON.stringify(stored)).not.toMatch(/https?:|youtube\.com|vk\.com|t=10s/);
  for (const user of [viewer, member]) {
    await expect(read(id, user)).rejects.toMatchObject(notFound);
    await expect(updateCatalogItem(f.db, user, tenant, id, { version: 1, draft: structured("structured-course") })).rejects.toMatchObject(notFound);
    for (const table of [catalogLevels, catalogSections, catalogLessons])
      await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.select().from(table))).resolves.toEqual([]);
  }
  await expect(getCatalogDraft(f.db, other, foreignTenant, id)).rejects.toMatchObject(notFound);
});

it("reorders, renames and moves lessons between sections, keeping ids, and falls back to default labels", async () => {
  const { id } = await createCatalogItem(f.db, owner, tenant, structured("reordered-course"));
  const item = await read(id);
  const [prayer, untitled, scripture] = item.sections, [foundations, second] = item.levels, byTitle = (title: string) => item.lessons.find((row) => row.title === title)!;
  const keep = (title: string, extra: Record<string, unknown> = {}) => ({ id: byTitle(title).id, ...lesson(title), ...extra });
  // Swap the levels, move "How to pray" into Scripture and drop the untitled section and its draft lesson; reset the labels.
  await updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...structured("reordered-course"), labels: { level: "", section: null, lesson: "Session" }, levels: [
    { id: second.id, title: "Going deeper", sections: [{ id: scripture.id, title: "Scripture", lessons: [keep("How to pray"), keep("Reading plan", { videoUrl: "https://vkvideo.ru/video-1_2" })] }] },
    { id: foundations.id, title: "Foundations", sections: [{ id: prayer.id, title: "Prayer", lessons: [keep("Why pray", { videoUrl: null })] }] },
  ] } });
  const next = await read(id);
  expect(next.labels).toEqual({ level: null, section: null, lesson: "Session" });
  expect(next.levels).toEqual([{ id: second.id, title: "Going deeper" }, { id: foundations.id, title: "Foundations" }]);
  expect(next.sections).toEqual([{ id: scripture.id, levelId: second.id, title: "Scripture" }, { id: prayer.id, levelId: foundations.id, title: "Prayer" }]);
  expect(next.lessons.map((row) => [row.id, row.sectionId])).toEqual([[byTitle("How to pray").id, scripture.id], [byTitle("Reading plan").id, scripture.id], [byTitle("Why pray").id, prayer.id]]);
  expect(next.lessons.map((row) => row.video)).toEqual([null, { provider: "vk", id: "-1_2" }, null]);
  expect(next.sections.some((row) => row.id === untitled.id)).toBe(false);
  // Removing every level leaves the sections standing alone; a save without labels keeps them.
  await updateCatalogItem(f.db, owner, tenant, id, { version: 2, draft: { kind: "course", slug: "reordered-course", title: "Path", visibility: "unlisted",
    sections: [{ id: prayer.id, title: "", lessons: [keep("Why pray")] }] } });
  const flat = await read(id);
  expect(flat).toMatchObject({ levels: [], sections: [{ id: prayer.id, levelId: null, title: "" }], labels: { lesson: "Session" } });
  // The original flat shape still works and becomes one untitled section.
  await updateCatalogItem(f.db, owner, tenant, id, { version: 3, draft: { kind: "course", slug: "reordered-course", title: "Path", visibility: "unlisted",
    lessons: [keep("Why pray"), lesson("New lesson")] } });
  const legacy = await read(id);
  expect(legacy.sections).toHaveLength(1);
  expect(legacy.lessons.map((row) => [row.title, row.sectionId])).toEqual([["Why pray", legacy.sections[0].id], ["New lesson", legacy.sections[0].id]]);
});

it("rejects bad links, labels, foreign ids, mixed shapes and limits, and the database refuses forged rows", async () => {
  const { id } = await createCatalogItem(f.db, owner, tenant, structured("validated-course"));
  const item = await read(id);
  const draft = structured("validated-course");
  const withVideo = (videoUrl: string) => ({ ...draft, levels: [], sections: [{ title: "", lessons: [lesson("A", { videoUrl })] }] });
  for (const link of ["javascript:alert(1)", "data:text/html,hi", "https://example.invalid/watch?v=dQw4w9WgXcQ", "https://youtube.com.example.invalid/watch?v=dQw4w9WgXcQ", "<iframe src=x>"])
    await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: withVideo(link) }), link).rejects.toMatchObject({ name: "ZodError" });
  for (const labels of [{ level: "x".repeat(25) }, { section: "Week\u0000" }, { other: "Week" }])
    await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, labels } })).rejects.toMatchObject({ name: "ZodError" });
  await expect(createCatalogItem(f.db, owner, tenant, { kind: "download", slug: "labelled-download", title: "D", labels: { level: "x" }, fileIds: [] })).rejects.toMatchObject({ name: "ZodError" });
  await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, lessons: [] } })).rejects.toMatchObject({ name: "ZodError" });
  const many = Array.from({ length: 11 }, () => ({ title: "", sections: [] }));
  await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, levels: many } })).rejects.toMatchObject({ name: "ZodError" });
  const crowded = Array.from({ length: 2 }, () => ({ title: "", lessons: Array.from({ length: 26 }, (_, n) => lesson(`L${n}`)) }));
  await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, levels: undefined, sections: crowded } })).rejects.toMatchObject({ name: "ZodError" });
  // Ids from another course, or repeated, are the same unavailable answer as a missing item.
  const otherCourse = await read((await createCatalogItem(f.db, owner, tenant, structured("other-structured"))).id);
  const reuse = (sections: unknown[]) => updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, levels: undefined, sections } });
  await expect(reuse([{ id: otherCourse.sections[0].id, title: "", lessons: [] }])).rejects.toMatchObject(notFound);
  await expect(reuse([{ id: item.sections[0].id, title: "", lessons: [] }, { id: item.sections[0].id, title: "", lessons: [] }])).rejects.toMatchObject(notFound);
  await expect(updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, levels: [{ id: otherCourse.levels[0].id, title: "", sections: [] }] } })).rejects.toMatchObject(notFound);
  expect((await read(id)).version).toBe(1);
  // Raw rows: a forged video id or provider, a section from another course and an over-long label all fail their constraints.
  const [section] = item.sections, [row] = item.lessons;
  for (const [provider, video] of [["youtube", "x\" onload=\"1"], ["vk", "1_2&x=1"], ["vimeo", "123"], ["youtube", null]])
    await expect(f.admin.query("update catalog_lessons set video_provider=$1, video_id=$2 where item_id=$3 and id=$4", [provider, video, id, row.id])).rejects.toMatchObject({ code: "23514" });
  await expect(f.admin.query("update catalog_lessons set section_id=$1 where item_id=$2 and id=$3", [otherCourse.sections[0].id, id, row.id])).rejects.toMatchObject({ code: "23503" });
  await expect(f.admin.query("update catalog_sections set level_id=$1 where item_id=$2 and id=$3", [otherCourse.levels[0].id, id, section.id])).rejects.toMatchObject({ code: "23503" });
  await expect(f.admin.query("update catalog_items set level_label=$1 where id=$2", ["x".repeat(25), id])).rejects.toMatchObject({ code: "23514" });
  for (const label of [" Week", "Week ", "\tWeek"])
    await expect(f.admin.query("update catalog_items set section_label=$1 where id=$2", [label, id])).rejects.toMatchObject({ code: "23514" });
  // The API trims what it stores.
  await updateCatalogItem(f.db, owner, tenant, id, { version: 1, draft: { ...draft, labels: { level: "  Module  ", section: " Week", lesson: null } } });
  expect((await f.admin.query("select level_label, section_label from catalog_items where id=$1", [id])).rows).toEqual([{ level_label: "Module", section_label: "Week" }]);
  await expect(f.admin.query("update catalog_lessons set section_id=null where item_id=$1", [id])).rejects.toMatchObject({ code: "23502" });
});

it("gives an enrolled learner the published structure and videos only, and keeps access rules as before", async () => {
  const slug = "learner-structure";
  const { id } = await createCatalogItem(f.db, owner, tenant, structured(slug));
  await expect(getCatalogContent(f.db, learner, slug)).rejects.toMatchObject(notFound);
  await setCatalogState(f.db, owner, tenant, id, { version: 1, state: "published" });
  await expect(getPublicCatalogItem(f.db, slug)).resolves.toEqual({ slug, title: "Discipleship path", summary: "", kind: "course", priceLabel: "Free", hasCover: false });
  await expect(getCatalogContent(f.db, learner, slug)).rejects.toMatchObject(notFound);
  await enrolInCatalogItem(f.db, learner, slug);
  const content = await getCatalogContent(f.db, learner, slug) as unknown as {
    labels: unknown; levels: { id: string; title: string }[]; sections: { id: string; levelId: string; title: string }[];
    lessons: { title: string; sectionId: string; video: unknown; published?: boolean }[] };
  expect(content.labels).toEqual({ level: "Module", section: "Week", lesson: null });
  expect(content.levels.map((row) => row.title)).toEqual(["Foundations", ""]);
  // The untitled section holds only a draft lesson, so neither it nor the draft arrives.
  expect(content.sections.map((row) => row.title)).toEqual(["Prayer", "Scripture"]);
  expect(content.sections.map((row) => content.levels.findIndex((level) => level.id === row.levelId))).toEqual([0, 1]);
  expect(content.lessons.map((row) => [row.title, content.sections.findIndex((section) => section.id === row.sectionId)]))
    .toEqual([["Why pray", 0], ["How to pray", 0], ["Reading plan", 1]]);
  expect(content.lessons.map((row) => row.video)).toEqual([{ provider: "youtube", id: "dQw4w9WgXcQ" }, null, { provider: "vk", id: "-22822305_456241864_abc123" }]);
  expect(JSON.stringify(content)).not.toMatch(/"published"|Draft only/);
  for (const user of [viewer, member, other]) await expect(getCatalogContent(f.db, user, slug)).rejects.toMatchObject(notFound);
  // Archiving still closes it.
  await setCatalogState(f.db, owner, tenant, id, { version: 2, state: "archived" });
  await expect(getCatalogContent(f.db, learner, slug)).rejects.toMatchObject(notFound);
});

it("serves a hidden shelved course's structure to an enrolled community member only", async () => {
  const circle = (await createCommunity(f.db, owner, tenant, { name: "Structure circle", slug: "structure-circle" })).id;
  await openCommunity(circle);
  await enterCommunity(f.db, circleMember, "structure-circle", { rulesVersion: 0, adult: true });
  const slug = "hidden-structure";
  const { id } = await createCatalogItem(f.db, owner, tenant, { ...structured(slug), visibility: "hidden" });
  await setCatalogState(f.db, owner, tenant, id, { version: 1, state: "published" });
  await expect(getPublicCatalogItem(f.db, slug)).rejects.toMatchObject(notFound);
  await expect(enrolInCatalogItem(f.db, circleMember, slug)).rejects.toMatchObject(notFound);
  await setCommunityProductLink(f.db, owner, tenant, circle, id, { position: 0 });
  await expect(getPublicCatalogItem(f.db, slug, circleMember)).resolves.toMatchObject({ slug });
  await expect(enrolInCatalogItem(f.db, learner, slug)).rejects.toMatchObject(notFound);
  await enrolInCatalogItem(f.db, circleMember, slug);
  await expect(getCatalogContent(f.db, circleMember, slug)).resolves.toMatchObject({
    sections: [{ title: "Prayer" }, { title: "Scripture" }], lessons: [{ title: "Why pray" }, { title: "How to pray" }, { title: "Reading plan" }] });
  // The definer leaves no catalogue or community setting behind.
  const settings = await withUser(f.db, circleMember, async (tx) => {
    await tx.execute(sql`select public.catalog_access(${slug}, 'content', null)`);
    return (await tx.execute<{ a: string; b: string; c: string }>(sql`select current_setting('app.catalog_tenant', true) a, current_setting('app.catalog_slug', true) b,
      current_setting('app.community_definer_tenant', true) c`)).rows[0];
  });
  expect(Object.values(settings).every((value) => !value)).toBe(true);
});

it("forces row security on the new tables, scopes them to one ministry, and grants nothing to other ministries", async () => {
  expect((await f.admin.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('catalog_levels','catalog_sections') and relnamespace = 'public'::regnamespace order by relname`)).rows).toEqual([
    { relname: "catalog_levels", relrowsecurity: true, relforcerowsecurity: true }, { relname: "catalog_sections", relrowsecurity: true, relforcerowsecurity: true }]);
  expect((await f.admin.query(`select table_name, string_agg(privilege_type, ',' order by privilege_type) privileges from information_schema.role_table_grants
    where grantee = 'harvest_app' and table_name in ('catalog_levels','catalog_sections','catalog_lessons') group by table_name order by table_name`)).rows).toEqual([
    { table_name: "catalog_lessons", privileges: "DELETE,INSERT,SELECT,UPDATE" }, { table_name: "catalog_levels", privileges: "DELETE,INSERT,SELECT,UPDATE" },
    { table_name: "catalog_sections", privileges: "DELETE,INSERT,SELECT,UPDATE" }]);
  const { id } = await createCatalogItem(f.db, owner, tenant, structured("isolated-course"));
  const item = await read(id);
  for (const table of [catalogLevels, catalogSections])
    await expect(withTenant(f.db, other, foreignTenant, "workspace:read", (tx) => tx.select().from(table))).resolves.toEqual([]);
  // A foreign owner can neither write into this ministry's course nor attach rows to it from their own ministry.
  await expect(withTenant(f.db, other, foreignTenant, "catalog:manage", (tx) => tx.insert(catalogSections).values({ tenantId: tenant, itemId: id, position: 9, title: "" })))
    .rejects.toThrow();
  await expect(withTenant(f.db, other, foreignTenant, "catalog:manage", (tx) => tx.insert(catalogLevels).values({ tenantId: foreignTenant, itemId: id, position: 9, title: "" })))
    .rejects.toThrow();
  await expect(withTenant(f.db, other, foreignTenant, "catalog:manage", (tx) => tx.execute(sql`update catalog_sections set title = 'x' where item_id = ${id}::uuid returning id`)))
    .resolves.toMatchObject({ rows: [] });
  expect((await read(id)).sections).toEqual(item.sections);
  expect((await f.admin.query(`select roles::text[] roles, cmd from pg_policies where schemaname = 'public' and tablename in ('catalog_levels','catalog_sections')
    and policyname = 'catalog_resolver_scope' order by tablename`)).rows.every((row) => row.cmd === "SELECT" && !row.roles.includes("harvest_app"))).toBe(true);
});
