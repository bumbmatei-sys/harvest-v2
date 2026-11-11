import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import * as schema from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { getLanding, writeLanding, resolvePublishedLanding } from "../../src/server/connect-landing";
import journal from "../../drizzle/meta/_journal.json";
it.each(["fresh", "populated 0029"])("0030 restricted-owner migration and replay: %s", async scenario => {
  const dir = await mkdtemp(join(tmpdir(), "harvest-landing-owner-")), server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve()));
  const password = randomBytes(24).toString("hex"), pg = new EmbeddedPostgres({ databaseDir: join(dir, "data"), port, user: "postgres", password,
    persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
  let root: Client | undefined, owner: Client | undefined, pool: Pool | undefined;
  try {
    await pg.initialise(); await pg.start(); root = pg.getPgClient("postgres", "127.0.0.1"); await root.connect();
    await root.query("create role harvest_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create role landing_migration_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create database harvest_test_landing_owner owner landing_migration_owner");
    owner = pg.getPgClient("harvest_test_landing_owner", "127.0.0.1"); await owner.connect(); await owner.query("set role landing_migration_owner");
    const db = drizzle(owner);
    pool = new Pool({ host: "127.0.0.1", port, database: "harvest_test_landing_owner", user: "postgres", password, max: 1, options: "-c role=harvest_app" });
    const app = drizzle(pool, { schema });
    const old: { tenant: string; campaign: string; id: string; code: string; short: string; actor: string }[] = [];
    if (scenario === "populated 0029") {
      const folder = join(dir, "through29"); await cp("drizzle", folder, { recursive: true });
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter(e => e.idx <= 29) }));
      await migrate(db, { migrationsFolder: folder });
      for (let i = 0; i < 2; i++) {
        const actor = `old-${i}`; await app.insert(schema.users).values({ id: actor, name: actor, email: `${actor}@example.test` });
        // Seed with SQL that matches the 0029 schema: today's createWorkspace names columns added later (0033 audience).
        const tenant = randomUUID(), seed = pg.getPgClient("harvest_test_landing_owner", "127.0.0.1"); await seed.connect();
        try {
          await seed.query("insert into workspaces (tenant_id,name,created_by) values ($1,$2,$3)", [tenant, `Existing ${i}`, actor]);
          await seed.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,$2,'owner')", [tenant, actor]);
        } finally { await seed.end(); }
        const campaign = (await createCampaign(app, actor, tenant, { name: "Existing campaign", type: "conference" }, randomUUID())).id;
        const l = await createConnectLink(app, actor, tenant, campaign, {}); await transitionConnectLink(app, actor, tenant, campaign, l.id, { action: "publish" });
        old.push({ tenant, campaign, id: l.id, code: l.publicCode, short: l.shortCode, actor });
      }
    }
    await migrate(db, { migrationsFolder: "drizzle" }); await migrate(db, { migrationsFolder: "drizzle" });
    expect((await owner.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBe(journal.entries.length);
    expect((await owner.query("select count(*)::int as n from connect_landing_states")).rows[0].n).toBe(0);
    expect((await owner.query("select rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    for (const table of ["connect_landing_states", "connect_landing_versions"]) {
      expect((await owner.query("select relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) as owner from pg_class where relname=$1", [table])).rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true, owner: "landing_migration_owner" });
    }
    for (const l of old) {
      expect((await getLanding(app, l.actor, l.tenant, l.campaign, l.id)).revision).toBe(0);
      for (const [kind, code] of [["qr", l.code], ["short", l.short]] as const) expect(await resolvePublishedLanding(app, kind, code)).toEqual({ locale: "en", title: null, definition: undefined });
    }
    const actor = "new-owner"; await app.insert(schema.users).values({ id: actor, name: actor, email: `${actor}@example.test` });
    const tenant = (await createWorkspace(app, actor, "New landing")).tenantId;
    const campaign = (await createCampaign(app, actor, tenant, { name: "New campaign", type: "conference" }, randomUUID())).id;
    const l = await createConnectLink(app, actor, tenant, campaign, {}), definition = { heading: "Welcome", message: "Safe upgrade", cards: [] };
    expect(await writeLanding(app, actor, tenant, campaign, l.id, { definition, expectedRevision: 0, expectedCode: l.publicCode })).toMatchObject({ revision: 1 });
    await writeLanding(app, actor, tenant, campaign, l.id, { expectedRevision: 1, expectedCode: l.publicCode }, true);
    await transitionConnectLink(app, actor, tenant, campaign, l.id, { action: "publish" });
    expect(await resolvePublishedLanding(app, "qr", l.publicCode)).toMatchObject({ definition });
    expect(await resolvePublishedLanding(app, "short", l.shortCode)).toMatchObject({ definition });
    // Resolver-local scope is cleared on a reused connection; owners obey FORCE RLS too.
    expect((await owner.query("select count(*)::int as n from connect_landing_states")).rows[0].n).toBe(0);
    expect((await owner.query("select count(*)::int as n from connect_landing_versions")).rows[0].n).toBe(0);
  } finally { await pool?.end(); await owner?.end(); await root?.end(); await pg.stop(); await rm(dir, { recursive: true, force: true }); }
}, 60000);
