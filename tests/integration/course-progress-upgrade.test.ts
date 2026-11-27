import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// 0131 makes the catalogue position uniques deferrable and adds the progress and notes tables. It moves no data, so it needs no backfill; this checks,
// as the NOBYPASSRLS migration owner, that existing courses keep every lesson and section and that the tables still force row security.
const tenant = randomUUID(), course = randomUUID(), section = randomUUID(), lessons = [randomUUID(), randomUUID()];
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({
    migrationOwner: true,
    async beforeCourseProgressMigration(db) {
      await db.query("insert into users (id,name,email) values ('progress-upgrade-owner','Owner','progress-upgrade-owner@example.invalid')");
      await db.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Upgrade ministry','progress-upgrade-owner')", [tenant]);
      await db.query("insert into catalog_items (tenant_id,id,kind,slug,title,state,visibility,created_by) values ($1,$2,'course','progress-upgrade','Course','published','listed','progress-upgrade-owner')", [tenant, course]);
      await db.query("insert into catalog_sections (tenant_id,item_id,id,position,title) values ($1,$2,$3,0,'Week')", [tenant, course, section]);
      const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] });
      await db.query("insert into catalog_lessons (tenant_id,item_id,id,position,title,body,published,section_id) values ($1,$2,$3,0,'One',$5,true,$6),($1,$2,$4,1,'Two',$5,true,$6)",
        [tenant, course, lessons[0], lessons[1], body, section]);
    },
  });
});
afterAll(async () => { await f?.close(); });

it("keeps existing lessons and sections, makes position uniques deferrable and forces row security on the new tables", async () => {
  expect(f.migrationOwner).toBeTruthy();
  expect((await f.admin.query("select id, position, section_id from catalog_lessons where item_id=$1 order by position", [course])).rows)
    .toEqual([{ id: lessons[0], position: 0, section_id: section }, { id: lessons[1], position: 1, section_id: section }]);
  expect((await f.admin.query(`select conname, condeferrable, condeferred from pg_constraint where conname in
    ('catalog_lessons_tenant_id_item_id_position_unique','catalog_sections_tenant_id_item_id_position_unique','catalog_levels_tenant_id_item_id_position_unique') order by conname`)).rows
    .every((row) => row.condeferrable && row.condeferred)).toBe(true);
  // A swap inside one transaction now passes; a real duplicate still fails at commit.
  await f.admin.query("begin");
  await f.admin.query("update catalog_lessons set position = 1 - position where item_id=$1", [course]);
  await f.admin.query("commit");
  await f.admin.query("begin");
  await f.admin.query("update catalog_lessons set position = 0 where item_id=$1", [course]);
  await expect(f.admin.query("commit")).rejects.toMatchObject({ code: "23505" });
  expect((await f.admin.query(`select relname, relforcerowsecurity from pg_class where relname in ('catalog_progress','catalog_notes','catalog_lessons')
    and relnamespace='public'::regnamespace order by relname`)).rows.every((row) => row.relforcerowsecurity)).toBe(true);
});
