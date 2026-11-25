import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Client } from "pg";
import { expect, it } from "vitest";
import journal from "../../drizzle/meta/_journal.json";

// The Docs collaboration migration is installed by an actual restricted owner (no superuser, no bypass), fresh and over populated 0089 data.
it.each(["fresh", "populated 0089"])("applies the Docs collaboration migration as the restricted owner: %s", async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-docs-owner-"));
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const embedded = new EmbeddedPostgres({ databaseDir: join(directory, "data"), port, user: "postgres", password: randomBytes(24).toString("hex"), persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
  const root = embedded.getPgClient("postgres", "127.0.0.1");
  let admin: Client | undefined, owner: Client | undefined;
  try {
    await embedded.initialise(); await embedded.start(); await root.connect();
    await root.query("create role harvest_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create role docs_migration_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create database harvest_test_docs_owner owner docs_migration_owner");
    admin = embedded.getPgClient("harvest_test_docs_owner", "127.0.0.1"); await admin.connect();
    owner = embedded.getPgClient("harvest_test_docs_owner", "127.0.0.1"); await owner.connect();
    await owner.query("set role docs_migration_owner");
    const db = drizzle(owner);
    const tenant = randomUUID(), docId = randomUUID();
    if (scenario === "populated 0089") {
      const folder = join(directory, "through-0089");
      await cp("drizzle", folder, { recursive: true });
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter((e) => e.tag <= "0089_docs") }));
      await migrate(db, { migrationsFolder: folder });
      await admin.query("insert into users (id,name,email) values ('docs-owner','docs-owner','docs-owner@example.test')");
      await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Synthetic docs','docs-owner')", [tenant]);
      await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'docs-owner','owner')", [tenant]);
      await admin.query("insert into docs (tenant_id,id,owner_id,title) values ($1,$2,'docs-owner','Existing doc')", [tenant, docId]);
    }
    await migrate(db, { migrationsFolder: "drizzle" });
    await migrate(db, { migrationsFolder: "drizzle" });
    const tables = (await owner.query("select count(*)::int as n from pg_tables where schemaname='public' and tablename in ('doc_shares','doc_comments','doc_links','doc_templates','doc_page_versions','doc_attachments','doc_notifications')")).rows[0].n;
    expect(tables).toBe(7);
    const forced = (await owner.query("select count(*)::int as n from pg_class where relname in ('doc_shares','doc_comments','doc_links','doc_templates','doc_page_versions','doc_attachments','doc_notifications') and relrowsecurity and relforcerowsecurity")).rows[0].n;
    expect(forced).toBe(7);
    if (scenario === "populated 0089") {
      // Docs that existed before keep ministry-wide read: the backfill must not make them private.
      expect((await admin.query("select visibility from docs where id=$1", [docId])).rows).toEqual([{ visibility: "ministry" }]);
    }
  } finally {
    await owner?.end().catch(() => undefined); await admin?.end().catch(() => undefined); await root.end().catch(() => undefined); await embedded.stop().catch(() => undefined);
  }
}, 240000);
