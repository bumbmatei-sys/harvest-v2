import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
import * as schema from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm,readIntakeManifest,submitIntake,applyIntakeRights } from "../../src/server/connect-intake";
import journal from "../../drizzle/meta/_journal.json";

// Always owns its cluster: never changes a shared TEST_DATABASE_URL or app-role password.
// SET ROLE is on the very connection Drizzle uses, before any DDL. Tables, functions and
// policies are installed by the actual restricted owner, rather than copied afterwards.
it.each(["fresh", "populated 0026"])("migrates and replays as the actual restricted owner: %s", async (scenario) => {
  const directory = await mkdtemp(join(tmpdir(), "harvest-hc05-owner-"));
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const password=randomBytes(24).toString("hex");
  const embedded = new EmbeddedPostgres({ databaseDir: join(directory, "data"), port, user: "postgres", password,
    persistent: false, autoRehydrateSymlinks: true, onLog: () => {}, onError: () => {} });
  const root = embedded.getPgClient("postgres", "127.0.0.1");
  let admin: Client | undefined, owner: Client | undefined;
  let appPool: Pool | undefined;
  try {
    await embedded.initialise(); await embedded.start(); await root.connect();
    await root.query("create role harvest_app nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create role hc05_migration_owner nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
    await root.query("create database harvest_test_hc05_owner owner hc05_migration_owner");
    admin = embedded.getPgClient("harvest_test_hc05_owner", "127.0.0.1"); await admin.connect();
    owner = embedded.getPgClient("harvest_test_hc05_owner", "127.0.0.1"); await owner.connect();
    await owner.query("set role hc05_migration_owner");
    expect((await owner.query(`select current_user, rolsuper, rolbypassrls, rolinherit,
      pg_has_role(current_user, 'harvest_app', 'MEMBER') as app_member
      from pg_roles where rolname = current_user`)).rows).toEqual([
      { current_user: "hc05_migration_owner", rolsuper: false, rolbypassrls: false, rolinherit: false, app_member: false },
    ]);
    const db = drizzle(owner);
    const originals: { tenant: string; campaign: string; actor: string; id: string; state: string; code: string }[] = [];
    if (scenario === "populated 0026") {
      const folder = join(directory, "through-0026");
      await cp("drizzle", folder, { recursive: true });
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.filter(({ idx }) => idx <= 26) }));
      await migrate(db, { migrationsFolder: folder });
      expect((await owner.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(27);
      // Fixture DML alone uses the administrator. No temporary test policies or grants.
      for (let tenantIndex = 0; tenantIndex < 2; tenantIndex++) {
        const tenant = randomUUID(), campaign = randomUUID(), actor = `owner-${tenantIndex}`;
        await admin.query("insert into users (id,name,email) values ($1,$1,$2)", [actor, `${actor}@example.test`]);
        await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Synthetic upgrade',$2)", [tenant, actor]);
        await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,$2,'owner')", [tenant, actor]);
        await admin.query(`insert into campaigns (tenant_id,id,owner_user_id,type,name,idempotency_key,fingerprint)
          values ($1,$2,$3,'conference','Synthetic upgrade','upgrade',$4)`, [tenant, campaign, actor, "b".repeat(64)]);
        for (const state of ["draft", "published", "disabled", "archived"]) {
          const id = randomUUID(), code = randomBytes(16).toString("hex");
          await admin.query(`insert into campaign_response_links (tenant_id,id,campaign_id,public_code,locale,created_by)
            values ($1,$2,$3,$4,'en',$5)`, [tenant, id, campaign, code, actor]);
          if (state !== "draft") await admin.query("update campaign_response_links set status = $1 where id = $2", [state, id]);
          originals.push({ tenant, campaign, actor, id, state, code });
        }
      }
      expect((await owner.query("select count(*)::int as count from campaign_response_links")).rows[0].count).toBe(0);
    }
    // A populated restricted-owner upgrade advances through the actual merged 0027 first.
    if (scenario !== "fresh") {
      const through27=join(directory,"through-0027");await cp("drizzle",through27,{recursive:true});
      await writeFile(join(through27,"meta/_journal.json"),JSON.stringify({...journal,entries:journal.entries.filter(({idx})=>idx<=27)}));
      await migrate(db,{migrationsFolder:through27});
    }
    // Keep the regression failure concise, including the SQLSTATE and rollback evidence.
    let failure: string | undefined;
    try { await migrate(db, { migrationsFolder: "drizzle" }); }
    catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause;
      const counts = (await admin.query(`select (select count(*) from campaign_response_links)::int as links,
        (select count(*) from drizzle.__drizzle_migrations)::int as migrations`)).rows[0];
      failure = `SQLSTATE ${cause?.code ?? "unknown"}; rollback ${JSON.stringify(counts)}`;
    }
    expect(failure, `${scenario} restricted-owner migration`).toBeUndefined();
    await migrate(db, { migrationsFolder: "drizzle" });
    expect((await owner.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(journal.entries.length);
    const { rows: links } = await admin.query("select * from campaign_response_links");
    expect(links).toHaveLength(originals.length);
    for (const original of originals) {
      const link = links.find(({ id }) => id === original.id);
      expect(link).toMatchObject({ tenant_id: original.tenant, public_code: original.code, status: original.state, code_generation: 1 });
      expect(link.short_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
      expect(link.published_at !== null).toBe(["published", "disabled"].includes(original.state));
      expect(link.archived_at !== null).toBe(original.state === "archived");
      const { rows: codes } = await admin.query("select kind,code,retired_at from campaign_response_link_codes where tenant_id=$1 and link_id=$2", [original.tenant, original.id]);
      expect(codes).toHaveLength(2);
      expect(codes.map(({ code }) => code).sort()).toEqual([original.code, link.short_code].sort());
      for (const code of codes) {
        expect(code.retired_at !== null).toBe(original.state === "archived");
        // Exercise the actual installed definer as the unprivileged app role.
        await admin.query("set role harvest_app");
        try {
          const resolved = await admin.query("select * from public.resolve_connect_link($1,$2)", [code.kind, code.code]);
          expect(resolved.rows).toHaveLength(original.state === "published" ? 1 : 0);
        } finally { await admin.query("reset role"); }
      }
    }
    expect(new Set(links.map(({ short_code }) => short_code)).size).toBe(originals.length);
    expect((await admin.query("select count(*)::int as count from campaign_response_link_codes")).rows[0].count).toBe(originals.length * 2);
    expect((await admin.query(`select convalidated from pg_constraint where conrelid='campaign_response_link_codes'::regclass and contype='f'`)).rows).toEqual([{ convalidated: true }]);
    expect((await admin.query(`select relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) as owner from pg_class
      where oid in ('campaign_response_links'::regclass,'campaign_response_link_codes'::regclass)`)).rows).toEqual([
      { relrowsecurity: true, relforcerowsecurity: true, owner: "hc05_migration_owner" },
      { relrowsecurity: true, relforcerowsecurity: true, owner: "hc05_migration_owner" },
    ]);
    const { rows: policies } = await admin.query(`select policyname,qual,with_check from pg_policies
      where schemaname='public' and 'hc05_migration_owner'=any(roles)`);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) {
      expect(policy.policyname).not.toMatch(/backfill/);
      expect(`${policy.qual} ${policy.with_check}`, policy.policyname).toContain("current_setting");
    }
    expect((await admin.query("select policyname from pg_policies where policyname like '%backfill%'")).rows).toEqual([]);
    for (const table of ["campaign_response_links", "campaign_response_link_codes"]) {
      const { rows } = await admin.query("select privilege_type from information_schema.role_table_grants where grantee='harvest_app' and table_name=$1 order by privilege_type", [table]);
      expect(rows.map(({ privilege_type }) => privilege_type)).toEqual(table === "campaign_response_links" ? ["INSERT", "SELECT"] : ["SELECT"]);
      expect((await owner.query(`select count(*)::int as count from ${table}`)).rows[0].count).toBe(0);
    }
    expect((await admin.query(`select distinct pg_get_userbyid(proowner) as owner from pg_proc
      where pronamespace='public'::regnamespace and proname in ('connect_link_transition','connect_register_link_codes','resolve_connect_link')`)).rows).toEqual([{ owner: "hc05_migration_owner" }]);
    // Exercise all new capabilities with functions/tables owned by this ACTUAL restricted role.
    vi.stubEnv("HARVEST_CONNECT_INTAKE","synthetic");vi.stubEnv("HARVEST_CONNECT_TEST_KEY","e".repeat(64));
    vi.stubEnv("DATABASE_URL",`postgresql://harvest_app:test@127.0.0.1:${port}/harvest_test_hc05_owner`);
    appPool=new Pool({host:"127.0.0.1",port,user:"postgres",password,database:"harvest_test_hc05_owner",options:"-c role=harvest_app",max:1});
    try {
      const app=drizzle(appPool,{schema});
      await app.insert(schema.users).values({id:"intake-owner",name:"Synthetic",email:"restricted@example.test"});
      const tenant=(await createWorkspace(app,"intake-owner","Synthetic restricted owner")).tenantId;
      const campaign=(await createCampaign(app,"intake-owner",tenant,{name:"Test",type:"conference"},"restricted-intake")).id;
      const version=await publishIntakeForm(app,"intake-owner",tenant,campaign,{name:"Test",notice:"Synthetic reviewed fixture only",retentionDays:1,
       purposes:["newsletter","outreach_follow_up"],definition:{kind:"connect-intake-v1",syntheticOnly:true,preferredName:false,followUpChannel:"email"}});
      const link=await createConnectLink(app,"intake-owner",tenant,campaign,{formVersionId:version.id});
      await transitionConnectLink(app,"intake-owner",tenant,campaign,link.id,{action:"publish"});
      const manifest=(await readIntakeManifest(app,"qr",link.publicCode))!;expect(manifest).not.toBeNull();
      const receiptToken=manifest.receiptToken;
      expect(await submitIntake(app,"qr",link.publicCode,{stamp:manifest.stamp,capability:manifest.capability,receiptToken,submissionId:randomUUID(),
       purposes:["newsletter","outreach_follow_up"],email:"test@example.test"})).toMatchObject({pending:true});
      expect(await applyIntakeRights(app,{receiptToken,action:"withdraw",purpose:"newsletter"})).toEqual({acknowledged:true});
      expect(await applyIntakeRights(app,{receiptToken,action:"erase"})).toEqual({acknowledged:true});
      for(const name of ["connect_intake_receipts","connect_intake_events","connect_intake_limits"])
       await expect(app.execute(sql.raw(`select * from ${name}`))).rejects.toMatchObject({cause:{code:"42501"}});
    } finally {await appPool.end();appPool=undefined;vi.unstubAllEnvs();}
  } finally {
    await appPool?.end();await owner?.end(); await admin?.end(); await root.end(); await embedded.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
