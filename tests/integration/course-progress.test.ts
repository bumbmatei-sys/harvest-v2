import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { catalogNotes, catalogProgress, users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCommunity, getCommunity, publishCommunity, updateCommunity } from "../../src/server/communities";
import { enterCommunity } from "../../src/server/community-joining";
import {
  createCatalogItem, enrolInCatalogItem, getCatalogContent, getCatalogDraft, getCatalogProgress, listMyNotes, saveLessonNote, setCatalogState,
  setCommunityProductLink, setLessonComplete, updateCatalogItem,
} from "../../src/server/free-catalog";
import { withTenant, withUser } from "../../src/server/tenancy";

// Courses follow-up slice 2 (0131): stable lesson saves, learner progress and private notes.
const learners = Array.from({ length: 6 }, (_, n) => `cp-learner-${n}`);
const people = ["cp-owner", "cp-admin", "cp-viewer", "cp-other", "cp-outsider", ...learners];
const [owner, admin, viewer, other, outsider] = people;
let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, foreignTenant: string;
const body = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });
const lesson = (title: string, extra: Record<string, unknown> = {}) => ({ title, body: body(title), published: true, ...extra });
const notFound = { status: 404 };
const course = (slug: string, visibility = "unlisted") => ({ kind: "course", slug, title: `Course ${slug}`, visibility,
  sections: [{ title: "Week one", lessons: [lesson("One"), lesson("Two"), lesson("Three"), lesson("Draft", { published: false })] }] });
type Content = { lessons: { id: string; title: string }[]; completed: string[]; notes: { lessonId: string; body: string }[] };
const content = async (user: string, slug: string) => (await getCatalogContent(f.db, user, slug)) as unknown as Content;
type Draft = { version: number; lessons: { id: string; title: string; body: unknown; published: boolean; sectionId: string }[]; sections: { id: string; title: string }[] };
const draft = async (id: string) => (await getCatalogDraft(f.db, owner, tenant, id)) as unknown as Draft;

async function published(slug: string, visibility = "unlisted", workspace = () => tenant, by = owner) {
  const { id } = await createCatalogItem(f.db, by, workspace(), course(slug, visibility));
  await setCatalogState(f.db, by, workspace(), id, { version: 1, state: "published" });
  return id;
}

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.invalid`, emailVerified: true })));
  tenant = (await createWorkspace(f.db, owner, "Progress Ministry", "church")).tenantId;
  foreignTenant = (await createWorkspace(f.db, other, "Other Ministry", "church")).tenantId;
  await putMember(f.db, owner, tenant, `${admin}@example.invalid`, "admin");
  await putMember(f.db, owner, tenant, `${viewer}@example.invalid`, "viewer");
});
afterAll(async () => { await f?.close(); });

it("lets only an enrolled learner mark their own published lessons, and shows only their own progress", async () => {
  const slug = "progress-course";
  await published(slug);
  const [a, b] = learners;
  const lessons = (await (async () => { await enrolInCatalogItem(f.db, a, slug); return content(a, slug); })()).lessons;
  expect(lessons.map((row) => row.title)).toEqual(["One", "Two", "Three"]);
  // Not enrolled, signed out of the course, or a lesson that is not published or not in this course: the same unavailable answer.
  await expect(setLessonComplete(f.db, b, slug, lessons[0].id, { completed: true })).rejects.toMatchObject(notFound);
  const draftLesson = (await draft((await f.admin.query("select id from catalog_items where slug=$1", [slug])).rows[0].id)).lessons.find((row) => !row.published)!;
  await expect(setLessonComplete(f.db, a, slug, draftLesson.id, { completed: true })).rejects.toMatchObject(notFound);
  await expect(setLessonComplete(f.db, a, "no-such-course", lessons[0].id, { completed: true })).rejects.toMatchObject(notFound);
  await expect(setLessonComplete(f.db, a, slug, lessons[0].id, { completed: "yes" })).rejects.toMatchObject({ name: "ZodError" });
  await expect(setLessonComplete(f.db, a, slug, lessons[0].id, { completed: true })).resolves.toEqual({ completed: true });
  await expect(setLessonComplete(f.db, a, slug, lessons[0].id, { completed: true })).resolves.toEqual({ completed: true });
  await setLessonComplete(f.db, a, slug, lessons[1].id, { completed: true });
  await setLessonComplete(f.db, a, slug, lessons[1].id, { completed: false });
  expect((await content(a, slug)).completed).toEqual([lessons[0].id]);
  await enrolInCatalogItem(f.db, b, slug);
  expect((await content(b, slug)).completed).toEqual([]);
  // Another learner cannot read or write a's rows, directly or with forged settings.
  await expect(withUser(f.db, b, (tx) => tx.select().from(catalogProgress))).resolves.toEqual([]);
  await expect(withUser(f.db, b, (tx) => tx.insert(catalogProgress).values({ tenantId: tenant, itemId: draftLesson.id, lessonId: lessons[2].id, userId: a }))).rejects.toThrow();
  await expect(withUser(f.db, a, (tx) => tx.insert(catalogProgress).values({ tenantId: tenant, itemId: draftLesson.id, lessonId: lessons[2].id, userId: a }))).rejects.toThrow();
  await expect(withUser(f.db, b, async (tx) => {
    await tx.execute(sql`select set_config('app.catalog_learner_tenant', ${tenant}, true)`);
    return (await tx.execute(sql`delete from catalog_progress returning lesson_id`)).rows;
  })).rejects.toThrow();
  await expect(withUser(f.db, a, (tx) => tx.select({ lessonId: catalogProgress.lessonId }).from(catalogProgress))).resolves.toEqual([{ lessonId: lessons[0].id }]);
  // Staff of the ministry read no row either.
  for (const user of [owner, admin, viewer]) await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.select().from(catalogProgress))).resolves.toEqual([]);
});

it("keeps notes private to the learner: plain text, capped, never readable by owners or admins", async () => {
  const slug = "notes-course";
  await published(slug);
  const [a, b] = learners;
  await enrolInCatalogItem(f.db, a, slug);
  const [first, second] = (await content(a, slug)).lessons;
  await expect(saveLessonNote(f.db, a, slug, first.id, { body: "Pray for\\nthe week" })).resolves.toEqual({ saved: true });
  await saveLessonNote(f.db, a, slug, first.id, { body: "  Pray daily.\nAsk a friend.  " });
  await saveLessonNote(f.db, a, slug, second.id, { body: "Second note" });
  expect((await content(a, slug)).notes).toEqual([{ lessonId: first.id, body: "Pray daily.\nAsk a friend." }, { lessonId: second.id, body: "Second note" }]);
  for (const bad of ["x".repeat(4001), "bell\u0007", "nul\u0000"]) await expect(saveLessonNote(f.db, a, slug, first.id, { body: bad })).rejects.toMatchObject({ name: "ZodError" });
  await expect(saveLessonNote(f.db, b, slug, first.id, { body: "Not enrolled" })).rejects.toMatchObject(notFound);
  await saveLessonNote(f.db, a, slug, second.id, { body: "   " });
  expect((await content(a, slug)).notes).toEqual([{ lessonId: first.id, body: "Pray daily.\nAsk a friend." }]);
  // Owners, admins and other learners read nothing; there is no staff policy on notes at all.
  for (const user of [owner, admin, viewer]) await expect(withTenant(f.db, user, tenant, "workspace:read", (tx) => tx.select().from(catalogNotes))).resolves.toEqual([]);
  await expect(withUser(f.db, b, (tx) => tx.select().from(catalogNotes))).resolves.toEqual([]);
  expect((await f.admin.query("select policyname, roles::text[] roles from pg_policies where tablename='catalog_notes' order by policyname")).rows
    .every((row) => row.policyname !== "catalog_staff_write" && !/staff/.test(row.policyname))).toBe(true);
  // A raw insert by the app is refused (no write grant).
  await expect(withUser(f.db, a, (tx) => tx.insert(catalogNotes).values({ tenantId: tenant, itemId: first.id, lessonId: first.id, userId: a, body: "x" }))).rejects.toThrow();
  // My notes lists the learner's own notes with the course and lesson titles.
  expect(await listMyNotes(f.db, a)).toEqual(expect.arrayContaining([expect.objectContaining({ lessonId: first.id, body: "Pray daily.\nAsk a friend.",
    course: { slug, title: `Course ${slug}` }, lesson: "One" })]));
  expect((await listMyNotes(f.db, b)).some((note) => note.lessonId === first.id)).toBe(false);
  expect(await listMyNotes(f.db, owner)).toEqual([]);
  // Deleting the account removes the notes and progress (cascade); there is no separate learner export yet.
  await setLessonComplete(f.db, a, slug, first.id, { completed: true });
  await f.db.insert(users).values({ id: "cp-gone", name: "Gone", email: "cp-gone@example.invalid", emailVerified: true });
  await enrolInCatalogItem(f.db, "cp-gone", slug);
  await saveLessonNote(f.db, "cp-gone", slug, first.id, { body: "Mine" });
  await setLessonComplete(f.db, "cp-gone", slug, first.id, { completed: true });
  await f.admin.query("delete from users where id='cp-gone'");
  expect((await f.admin.query("select (select count(*) from catalog_notes where user_id='cp-gone')::int notes, (select count(*) from catalog_progress where user_id='cp-gone')::int progress")).rows)
    .toEqual([{ notes: 0, progress: 0 }]);
});

it("gives owners and admins counts only, withholding groups under 5", async () => {
  const slug = "counted-course";
  const id = await published(slug);
  const lessons = await (async () => { await enrolInCatalogItem(f.db, learners[0], slug); return (await content(learners[0], slug)).lessons; })();
  for (const user of learners.slice(1)) await enrolInCatalogItem(f.db, user, slug);
  for (const user of learners) await setLessonComplete(f.db, user, slug, lessons[0].id, { completed: true });
  for (const user of learners.slice(0, 2)) await setLessonComplete(f.db, user, slug, lessons[1].id, { completed: true });
  for (const user of [owner, admin]) {
    const summary = await getCatalogProgress(f.db, user, tenant, id);
    expect(summary).toMatchObject({ enrolled: 6, minimumGroup: 5 });
    expect(summary.lessons.map((row) => [row.title, row.completed])).toEqual([["One", 6], ["Two", null], ["Three", 0], ["Draft", 0]]);
    expect(JSON.stringify(summary)).not.toMatch(/cp-learner|user/);
  }
  for (const user of [viewer, other, learners[0]]) await expect(getCatalogProgress(f.db, user, tenant, id)).rejects.toMatchObject(notFound);
  await expect(getCatalogProgress(f.db, other, foreignTenant, id)).rejects.toMatchObject(notFound);
  // The database applies the same rule, whatever the app does with the result, and refuses the internal function.
  const raw = await withTenant(f.db, owner, tenant, "catalog:manage", (tx) => tx.execute<{ data: { enrolled: number; lessons: { completed: number | null }[] } }>(
    sql`select public.catalog_progress_summary(${tenant}::uuid, ${id}::uuid) as data`));
  expect(raw.rows[0].data.lessons[1].completed).toBeNull();
  await expect(withTenant(f.db, owner, tenant, "catalog:manage", (tx) => tx.execute(sql`select public.catalog_progress_summary_scoped(${tenant}::uuid, ${id}::uuid)`))).rejects.toThrow();
  const small = await published("small-course");
  await enrolInCatalogItem(f.db, learners[0], "small-course");
  expect(await getCatalogProgress(f.db, owner, tenant, small)).toMatchObject({ enrolled: null });
});

it("keeps progress and notes across edits, reorders and moves; removing a lesson removes its rows", async () => {
  const slug = "edited-course";
  const id = await published(slug);
  const a = learners[2];
  await enrolInCatalogItem(f.db, a, slug);
  const [one, two, three] = (await content(a, slug)).lessons;
  await setLessonComplete(f.db, a, slug, one.id, { completed: true });
  await setLessonComplete(f.db, a, slug, three.id, { completed: true });
  await saveLessonNote(f.db, a, slug, three.id, { body: "Keep me" });
  await setCatalogState(f.db, owner, tenant, id, { version: 2, state: "draft" });
  const before = await draft(id);
  const keep = (title: string) => { const row = before.lessons.find((item) => item.title === title)!; return { id: row.id, title: row.title, body: row.body, published: row.published }; };
  // Reverse the order, move "Three" into a new section, rename it, and drop "Two".
  await updateCatalogItem(f.db, owner, tenant, id, { version: 3, draft: { kind: "course", slug, title: "Edited", visibility: "unlisted", sections: [
    { id: before.sections[0].id, title: "Week one", lessons: [keep("Draft"), keep("One")] },
    { title: "Week two", lessons: [{ ...keep("Three"), title: "Three, renamed" }, lesson("New")] },
  ] } });
  const after = await draft(id);
  expect(after.lessons.map((row) => row.title)).toEqual(["Draft", "One", "Three, renamed", "New"]);
  expect(after.lessons.find((row) => row.title === "One")!.id).toBe(one.id);
  expect(after.lessons.find((row) => row.title === "Three, renamed")!.id).toBe(three.id);
  await setCatalogState(f.db, owner, tenant, id, { version: 4, state: "published" });
  const now = await content(a, slug);
  expect(now.completed).toEqual([one.id, three.id]);
  expect(now.notes).toEqual([{ lessonId: three.id, body: "Keep me" }]);
  expect((await f.admin.query("select count(*)::int n from catalog_lessons where id=$1", [two.id])).rows).toEqual([{ n: 0 }]);
  // Removing a lesson removes that learner's rows on it (cascade), nothing else.
  await setCatalogState(f.db, owner, tenant, id, { version: 5, state: "draft" });
  const current = await draft(id);
  await updateCatalogItem(f.db, owner, tenant, id, { version: 6, draft: { kind: "course", slug, title: "Edited", visibility: "unlisted",
    sections: current.sections.map((section) => ({ id: section.id, title: section.title, lessons: current.lessons.filter((row) => row.sectionId === section.id && row.id !== three.id)
      .map((row) => ({ id: row.id, title: row.title, body: row.body, published: row.published })) })) } });
  expect((await f.admin.query("select lesson_id from catalog_progress where user_id=$1 and item_id=$2", [a, id])).rows).toEqual([{ lesson_id: one.id }]);
  expect((await f.admin.query("select count(*)::int n from catalog_notes where user_id=$1 and item_id=$2", [a, id])).rows).toEqual([{ n: 0 }]);
});

it("keeps progress when a hidden course leaves a community shelf, and shows it again when it returns", async () => {
  const circle = (await createCommunity(f.db, owner, tenant, { name: "Progress circle", slug: "progress-circle" })).id;
  const { version } = await getCommunity(f.db, owner, tenant, circle);
  const updated = await updateCommunity(f.db, owner, tenant, circle, { version, visibility: "listed", allowOpen: true });
  await publishCommunity(f.db, owner, tenant, circle, { version: updated.version, published: true });
  const a = learners[3];
  await enterCommunity(f.db, a, "progress-circle", { rulesVersion: 0, adult: true });
  const slug = "shelved-progress";
  const id = await published(slug, "hidden");
  await setCommunityProductLink(f.db, owner, tenant, circle, id, { position: 0 });
  await enrolInCatalogItem(f.db, a, slug);
  const [first] = (await content(a, slug)).lessons;
  await setLessonComplete(f.db, a, slug, first.id, { completed: true });
  await saveLessonNote(f.db, a, slug, first.id, { body: "Shelf note" });
  await setCommunityProductLink(f.db, owner, tenant, circle, id, undefined, true);
  await expect(getCatalogContent(f.db, a, slug)).rejects.toMatchObject(notFound);
  await expect(setLessonComplete(f.db, a, slug, first.id, { completed: false })).rejects.toMatchObject(notFound);
  expect((await f.admin.query("select count(*)::int n from catalog_progress where user_id=$1 and item_id=$2", [a, id])).rows).toEqual([{ n: 1 }]);
  await setCommunityProductLink(f.db, owner, tenant, circle, id, { position: 0 });
  expect(await content(a, slug)).toMatchObject({ completed: [first.id], notes: [{ lessonId: first.id, body: "Shelf note" }] });
  await expect(getCatalogContent(f.db, outsider, slug)).rejects.toMatchObject(notFound);
});

it("forces row security, grants the app read only, and keeps two ministries apart", async () => {
  expect((await f.admin.query(`select relname, relforcerowsecurity from pg_class where relname in ('catalog_progress','catalog_notes')
    and relnamespace='public'::regnamespace order by relname`)).rows).toEqual([{ relname: "catalog_notes", relforcerowsecurity: true }, { relname: "catalog_progress", relforcerowsecurity: true }]);
  expect((await f.admin.query(`select table_name, string_agg(privilege_type, ',' order by privilege_type) p from information_schema.role_table_grants
    where grantee='harvest_app' and table_name in ('catalog_progress','catalog_notes') group by table_name order by table_name`)).rows)
    .toEqual([{ table_name: "catalog_notes", p: "SELECT" }, { table_name: "catalog_progress", p: "SELECT" }]);
  const foreignSlug = "foreign-progress";
  const foreignId = await published(foreignSlug, "unlisted", () => foreignTenant, other);
  const a = learners[4];
  for (const slug of [foreignSlug, "progress-course"]) await enrolInCatalogItem(f.db, a, slug);
  const [foreignLesson] = (await content(a, foreignSlug)).lessons;
  await setLessonComplete(f.db, a, foreignSlug, foreignLesson.id, { completed: true });
  // A lesson id from the other ministry's course cannot be marked through this course's address.
  await expect(setLessonComplete(f.db, a, "progress-course", foreignLesson.id, { completed: true })).rejects.toMatchObject(notFound);
  expect((await getCatalogProgress(f.db, owner, tenant, (await f.admin.query("select id from catalog_items where slug='progress-course'")).rows[0].id)).lessons
    .every((row) => row.completed === null || row.completed === 0)).toBe(true);
  await expect(getCatalogProgress(f.db, owner, tenant, foreignId)).rejects.toMatchObject(notFound);
  expect((await getCatalogProgress(f.db, other, foreignTenant, foreignId)).lessons[0].completed).toBeNull();
  // The definers leave no setting behind.
  const settings = await withUser(f.db, a, async (tx) => {
    await tx.execute(sql`select public.catalog_learner(${foreignSlug}, ${foreignLesson.id}::uuid, 'complete', null)`);
    await tx.execute(sql`select public.catalog_my_notes()`);
    return (await tx.execute<Record<string, string>>(sql`select current_setting('app.catalog_learner_tenant', true) a, current_setting('app.catalog_tenant', true) b,
      current_setting('app.catalog_slug', true) c, current_setting('app.catalog_my_notes', true) d, current_setting('app.community_definer_tenant', true) e`)).rows[0];
  });
  expect(Object.values(settings).every((value) => !value)).toBe(true);
  for (const name of ["catalog_learner", "catalog_my_notes", "catalog_progress_summary", "catalog_access"]) {
    const [row] = (await f.admin.query(`select prosecdef, proconfig::text[] config from pg_proc where proname=$1 and pronamespace='public'::regnamespace`, [name])).rows;
    expect(row, name).toMatchObject({ prosecdef: true, config: ["search_path=pg_catalog, pg_temp"] });
  }
});
