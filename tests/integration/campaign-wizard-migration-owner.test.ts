import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { expect, it } from "vitest";
import journal from "../../drizzle/meta/_journal.json";

// The migration runs as a real restricted owner (no superuser, no BYPASSRLS), on a fresh database and on one populated before 0092.
it.each(["fresh", "populated 0088"])("installs the wizard tables as the restricted owner and keeps existing campaigns: %s", async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-cw-owner-"));
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const embedded = new EmbeddedPostgres({ databaseDir: join(directory, "data"), port, user: "postgres", password: randomBytes(24).toString("hex"),
    persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
  const root = embedded.getPgClient("postgres", "127.0.0.1");
  let admin: Client | undefined, owner: Client | undefined;
  try {
    await embedded.initialise(); await embedded.start(); await root.connect();
    await root.query("create role harvest_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create role cw_migration_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create database harvest_test_cw_owner owner cw_migration_owner");
    admin = embedded.getPgClient("harvest_test_cw_owner", "127.0.0.1"); await admin.connect();
    owner = embedded.getPgClient("harvest_test_cw_owner", "127.0.0.1"); await owner.connect();
    await owner.query("set role cw_migration_owner");
    const db = drizzle(owner);
    const tenant = randomUUID(), campaign = randomUUID();
    if (scenario === "populated 0088") {
      const folder = join(directory, "through-0088");
      await cp("drizzle", folder, { recursive: true });
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter(({ idx }) => idx <= 88) }));
      await migrate(db, { migrationsFolder: folder });
      await admin.query("insert into users (id,name,email) values ('owner-1','o','o@example.test')");
      await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Synthetic upgrade','owner-1')", [tenant]);
      await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'owner-1','owner')", [tenant]);
      await admin.query(`insert into campaigns (tenant_id,id,owner_user_id,type,name,idempotency_key,fingerprint) values ($1,$2,'owner-1','conference','Existing','e',$3)`, [tenant, campaign, "b".repeat(64)]);
    }
    await migrate(db, { migrationsFolder: "drizzle" });
    await migrate(db, { migrationsFolder: "drizzle" });
    expect((await owner.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(journal.entries.length);
    expect((await admin.query(`select relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) as owner from pg_class
      where relname in ('campaign_drafts','campaign_draft_assignments') order by relname`)).rows).toEqual([
      { relname: "campaign_draft_assignments", relrowsecurity: true, relforcerowsecurity: true, owner: "cw_migration_owner" },
      { relname: "campaign_drafts", relrowsecurity: true, relforcerowsecurity: true, owner: "cw_migration_owner" },
    ]);
    expect((await admin.query("select count(*)::int as n from pg_proc where prosecdef and pronamespace='public'::regnamespace and prosrc ilike '%campaign_draft%' and proname <> 'campaign_invitation_accept'")).rows[0].n).toBe(0); // the one definer accepts an invitation (0107)
    for (const table of ["campaign_drafts", "campaign_draft_assignments"]) {
      const { rows } = await admin.query("select privilege_type from information_schema.role_table_grants where grantee='harvest_app' and table_name=$1 order by privilege_type", [table]);
      expect(rows.map(({ privilege_type }) => privilege_type)).toEqual(table === "campaign_drafts" ? ["INSERT", "SELECT"] : ["DELETE", "INSERT", "SELECT"]);
    }
    if (scenario === "populated 0088") {
      expect((await admin.query("select status, name from campaigns where id=$1", [campaign])).rows).toEqual([{ status: "draft", name: "Existing" }]);
      // The runtime role, as an owner: reads its campaign, starts a draft, activates through the status policy only.
      await admin.query("set role harvest_app");
      try {
        await admin.query("begin");
        await admin.query("select set_config('app.tenant_id',$1,true), set_config('app.user_id','owner-1',true)", [tenant]);
        const created = await admin.query(`insert into campaign_drafts (tenant_id,created_by,client_key,budget,outreach) values ($1,'owner-1','k','{}','{}') returning id`, [tenant]);
        expect(created.rows).toHaveLength(1);
        expect((await admin.query("update campaigns set status='active', updated_at=now() where id=$1 returning status", [campaign])).rows).toEqual([{ status: "active" }]);
        await expect(admin.query("update campaigns set name='x' where id=$1", [campaign])).rejects.toMatchObject({ code: "42501" });
        await admin.query("rollback");
      } finally { await admin.query("rollback").catch(() => {}); await admin.query("reset role"); }
    }
  } finally {
    await owner?.end(); await admin?.end(); await root.end(); await embedded.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
