import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// 0123 adds the shelf `kind` to existing community_product_links. Both tables force row security (0061), so a NOBYPASSRLS
// migration owner would see no row to backfill; the migration lifts FORCE for its backfill only and puts it back.
const tenant = randomUUID(), community = randomUUID(), course = randomUUID(), download = randomUUID();
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({
    migrationOwner: true,
    async beforeCommunityShelfMigration(db) {
      await db.query("insert into users (id,name,email) values ('shelf-upgrade-owner','Owner','shelf-upgrade-owner@example.test')");
      await db.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Upgrade ministry','shelf-upgrade-owner')", [tenant]);
      await db.query("insert into communities (tenant_id,id,slug,name) values ($1,$2,'upgrade-circle','Upgrade circle')", [tenant, community]);
      await db.query(`insert into catalog_items (tenant_id,id,kind,slug,title,state,visibility,created_by) values
        ($1,$2,'course','upgrade-course','Course','published','listed','shelf-upgrade-owner'),
        ($1,$3,'download','upgrade-guide','Guide','published','unlisted','shelf-upgrade-owner')`, [tenant, course, download]);
      await db.query("insert into community_product_links (tenant_id,community_id,item_id,position) values ($1,$2,$3,0),($1,$2,$4,1)", [tenant, community, course, download]);
    },
  });
});
afterAll(async () => { await f?.close(); });

it("backfills each existing link's kind as the restricted migration owner and keeps FORCE row security", async () => {
  expect(f.migrationOwner).toBeTruthy();
  expect((await f.admin.query("select item_id, kind, featured from community_product_links order by position")).rows)
    .toEqual([{ item_id: course, kind: "course", featured: false }, { item_id: download, kind: "download", featured: false }]);
  expect((await f.admin.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class
    where relname in ('community_product_links','catalog_items') and relnamespace = 'public'::regnamespace order by relname`)).rows).toEqual([
    { relname: "catalog_items", relrowsecurity: true, relforcerowsecurity: true },
    { relname: "community_product_links", relrowsecurity: true, relforcerowsecurity: true },
  ]);
});
