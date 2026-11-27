import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// 0130 moves every existing lesson into one untitled section of its course. The catalogue tables force row security (0061), so a NOBYPASSRLS
// migration owner would see no lesson to move; the migration lifts FORCE for its backfill only and puts it back (the 0091 pattern).
const tenant = randomUUID(), course = randomUUID(), empty = randomUUID(), download = randomUUID(), other = randomUUID();
const lessons = [randomUUID(), randomUUID(), randomUUID()], otherLesson = randomUUID();
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({
    migrationOwner: true,
    async beforeCourseStructureMigration(db) {
      await db.query("insert into users (id,name,email) values ('structure-upgrade-owner','Owner','structure-upgrade-owner@example.invalid')");
      await db.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Upgrade ministry','structure-upgrade-owner')", [tenant]);
      await db.query(`insert into catalog_items (tenant_id,id,kind,slug,title,state,visibility,created_by) values
        ($1,$2,'course','upgrade-course','Course','published','listed','structure-upgrade-owner'),
        ($1,$3,'course','upgrade-empty','Empty course','draft','hidden','structure-upgrade-owner'),
        ($1,$4,'download','upgrade-download','Guide','draft','hidden','structure-upgrade-owner'),
        ($1,$5,'course','upgrade-other','Other course','draft','hidden','structure-upgrade-owner')`, [tenant, course, empty, download, other]);
      const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
      // Inserted out of order: the section keeps the lesson positions, not the insertion order.
      await db.query(`insert into catalog_lessons (tenant_id,item_id,id,position,title,body,published) values
        ($1,$2,$3,2,'Third',$7,true), ($1,$2,$4,0,'First',$7,true), ($1,$2,$5,1,'Second',$7,false), ($1,$6,$8,0,'Only',$7,true)`,
        [tenant, course, lessons[2], lessons[0], lessons[1], other, body, otherLesson]);
    },
  });
});
afterAll(async () => { await f?.close(); });

it("moves every existing lesson into one section of its own course, in order, as the restricted migration owner, keeping FORCE row security", async () => {
  expect(f.migrationOwner).toBeTruthy();
  const sections = (await f.admin.query("select item_id, level_id, position, title from catalog_sections order by item_id")).rows;
  expect(sections.map((row) => row.item_id).sort()).toEqual([course, other].sort());
  expect(sections.every((row) => row.level_id === null && row.position === 0 && row.title === "")).toBe(true);
  const moved = (await f.admin.query(`select l.id, l.title, l.position, l.published, l.section_id, s.item_id section_item, l.video_provider, l.video_id
    from catalog_lessons l join catalog_sections s on s.tenant_id = l.tenant_id and s.item_id = l.item_id and s.id = l.section_id
    where l.item_id = $1 order by l.position`, [course])).rows;
  expect(moved.map((row) => [row.id, row.title, row.position, row.published])).toEqual([[lessons[0], "First", 0, true], [lessons[1], "Second", 1, false], [lessons[2], "Third", 2, true]]);
  expect(new Set(moved.map((row) => row.section_id)).size).toBe(1);
  expect(moved.every((row) => row.section_item === course && row.video_provider === null && row.video_id === null)).toBe(true);
  expect((await f.admin.query("select count(*)::int n from catalog_lessons where section_id is null")).rows).toEqual([{ n: 0 }]);
  expect((await f.admin.query("select section_id from catalog_lessons where id = $1", [otherLesson])).rows[0].section_id).not.toBe(moved[0].section_id);
  expect((await f.admin.query("select count(*)::int n from catalog_levels")).rows).toEqual([{ n: 0 }]);
  expect((await f.admin.query("select level_label, section_label, lesson_label from catalog_items where id = $1", [course])).rows)
    .toEqual([{ level_label: null, section_label: null, lesson_label: null }]);
  expect((await f.admin.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('catalog_items','catalog_lessons','catalog_levels','catalog_sections') and relnamespace = 'public'::regnamespace order by relname`)).rows).toEqual([
    { relname: "catalog_items", relrowsecurity: true, relforcerowsecurity: true }, { relname: "catalog_lessons", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "catalog_levels", relrowsecurity: true, relforcerowsecurity: true }, { relname: "catalog_sections", relrowsecurity: true, relforcerowsecurity: true },
  ]);
});
