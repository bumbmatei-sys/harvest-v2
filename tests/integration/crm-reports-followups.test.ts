import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, getWorkspace, putMember, updateWorkspaceTimeZone } from "../../src/server/workspaces";
import { createContact, eraseContact } from "../../src/server/contacts";
import { createDeal, listPipelines, moveDeal, updateDeal } from "../../src/server/crm-deals";
import { mergeContacts } from "../../src/server/crm-merge";
import { getCrmReport } from "../../src/server/crm-reports";
import { exportCrmReportTable } from "../../src/server/crm-reports-export";
import { withTenant } from "../../src/server/tenancy";
import { AccessError } from "../../src/server/permissions";
import { createCompany } from "../../src/server/companies";

vi.mock("server-only", () => ({}));
let f: Awaited<ReturnType<typeof testDatabase>>;
vi.mock("@/db/client", () => ({ getDb: () => f.db }));
vi.mock("@/server/http", async (original) => ({
  ...await original<typeof import("../../src/server/http")>(),
  verifiedUser: async (request: Request) => { const user = request.headers.get("x-test-user"); if (!user) throw new AccessError(401, "Sign in to continue."); return user; },
}));

const now = new Date("2026-11-22T12:00:00Z");
const legacy = { tenant: randomUUID(), owner: "legacy-reports-owner", contact: randomUUID(), plain: randomUUID(), deal: randomUUID(), pipeline: randomUUID(), s1: randomUUID(), s2: randomUUID() };
const people = ["owner", "admin", "member", "viewer", "outsider", "owner-b"];
let tenant: string, other: string, stage: string[], company: string;
const run = (statement: string, params: unknown[] = []) => f.admin.query(statement, params);
/** Raw writes that fire the definer triggers need the tenant context the app sets (the owner role is under FORCE row security). */
async function inTenant(ministry: string, statement: string, params: unknown[] = []) {
  const client = await f.admin.connect();
  try { await client.query("begin"); await client.query("select set_config('app.tenant_id', $1, true)", [ministry]); await client.query(statement, params); await client.query("commit"); }
  catch (error) { await client.query("rollback"); throw error; } finally { client.release(); }
}
/** Backdating bypasses the guard triggers (replica role) on one connection. */
async function backdate(statement: string, params: unknown[]) {
  const client = await f.admin.connect();
  try { await client.query("set session_replication_role = replica"); await client.query(statement, params); } finally { await client.query("reset session_replication_role"); client.release(); }
}
const count = async (statement: string, params: unknown[] = []) => Number((await run(statement, params)).rows[0].n);

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true, beforeCrmReportsFollowupsMigration: async (admin) => {
    await admin.query("insert into users(id,name,email) values($1,'Legacy',$2)", [legacy.owner, `${legacy.owner}@example.test`]);
    await admin.query("insert into workspaces(tenant_id,name,created_by) values($1,'Legacy reports',$2)", [legacy.tenant, legacy.owner]);
    await admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'owner')", [legacy.tenant, legacy.owner]);
    await admin.query("insert into contacts(tenant_id,id,name) values($1,$2,'Legacy with events'),($1,$3,'Legacy without events')", [legacy.tenant, legacy.contact, legacy.plain]);
    await admin.query("insert into contact_source_events(tenant_id,contact_id,kind,outcome,occurred_at) values($1,$2,'manual','created','2026-09-05T10:00:00Z')", [legacy.tenant, legacy.contact]);
    await admin.query("set session_replication_role = replica");
    await admin.query("insert into crm_pipelines(tenant_id,id,name,is_default,created_by) values($1,$2,'Legacy pipeline',true,$3)", [legacy.tenant, legacy.pipeline, legacy.owner]);
    await admin.query("insert into crm_pipeline_stages(tenant_id,id,pipeline_id,key,name,kind,position,created_by) values($1,$2,$4,'first','First','open',1,$5),($1,$3,$4,'second','Second','open',2,$5)", [legacy.tenant, legacy.s1, legacy.s2, legacy.pipeline, legacy.owner]);
    await admin.query("insert into opportunities(tenant_id,id,name,pipeline_id,stage_id,created_by,created_at) values($1,$2,'Legacy deal',$3,$4,$5,'2026-09-01T10:00:00Z')", [legacy.tenant, legacy.deal, legacy.pipeline, legacy.s2, legacy.owner]);
    await admin.query("reset session_replication_role");
    // The audit log already holds the stage of every move; a malformed row and a row for a deal that does not exist are skipped.
    await admin.query(`insert into audit_logs(tenant_id,actor_id,action,target_id,metadata,created_at) values
      ($1,$2,'opportunity.move',$3,jsonb_build_object('fromStageId',$4::text,'toStageId',$5::text),'2026-10-01T10:00:00Z'),
      ($1,$2,'opportunity.move',$3,jsonb_build_object('fromStageId','not-a-uuid','toStageId',$5::text),'2026-10-02T10:00:00Z'),
      ($1,$2,'opportunity.move',gen_random_uuid()::text,jsonb_build_object('fromStageId',$4::text,'toStageId',$5::text),'2026-10-03T10:00:00Z')`, [legacy.tenant, legacy.owner, legacy.deal, legacy.s1, legacy.s2]);
  } });
  await f.db.insert(users).values(people.map((id) => ({ id, name: `Synthetic ${id}`, email: `${id}@example.test` })));
  tenant = (await createWorkspace(f.db, "owner", "Followups A")).tenantId;
  other = (await createWorkspace(f.db, "owner-b", "Followups B")).tenantId;
  for (const [id, role] of [["admin", "admin"], ["member", "member"], ["viewer", "viewer"]] as const) await putMember(f.db, "owner", tenant, `${id}@example.test`, role);
  const [pipeline] = await listPipelines(f.db, "owner", tenant);
  stage = pipeline!.stages.map((item) => item.id);
  company = (await createCompany(f.db, "owner", tenant, { name: "Synthetic Church" })).id;
}, 300_000);
afterAll(async () => { await f?.close(); });

describe("migration 0091 as a restricted owner", () => {
  it("backfills the durable source, the stage moves and the default time zone, and keeps FORCE row security on", async () => {
    expect((await run("select kind, first_seen_at from contact_first_sources where contact_id = $1", [legacy.contact])).rows).toEqual([{ kind: "manual", first_seen_at: new Date("2026-09-05T10:00:00Z") }]);
    expect(await count("select count(*) as n from contact_first_sources where contact_id = $1", [legacy.plain])).toBe(0);
    expect((await run("select from_stage_id, to_stage_id, moved_at, moved_by from crm_deal_stage_moves where tenant_id = $1", [legacy.tenant])).rows)
      .toEqual([{ from_stage_id: legacy.s1, to_stage_id: legacy.s2, moved_at: new Date("2026-10-01T10:00:00Z"), moved_by: legacy.owner }]);
    expect((await run("select time_zone from workspaces where tenant_id = $1", [legacy.tenant])).rows[0].time_zone).toBe("UTC");
    const { rows: [owner] } = await run("select rolsuper, rolbypassrls from pg_roles where rolname = $1", [f.migrationOwner]);
    expect(owner).toEqual({ rolsuper: false, rolbypassrls: false });
    const forced = await run(`select relname from pg_class where relname in ('contact_first_sources','crm_deal_stage_moves','contact_source_events','contact_form_sources','audit_logs','opportunities','contacts')
      and relkind = 'r' and not relforcerowsecurity`);
    expect(forced.rows).toEqual([]);
  });
  it("gives the app role read access only to owners and admins, and no write path or function access", async () => {
    for (const table of ["contact_first_sources", "crm_deal_stage_moves"]) {
      expect((await run("select has_table_privilege('harvest_app', $1, 'INSERT') as i, has_table_privilege('harvest_app', $1, 'UPDATE') as u, has_table_privilege('harvest_app', $1, 'DELETE') as d, has_table_privilege('harvest_app', $1, 'SELECT') as s", [table])).rows[0])
        .toEqual({ i: false, u: false, d: false, s: true });
    }
    for (const fn of ["contact_first_source_event()", "contact_first_source_manual_removed()", "contact_first_source_reverted()", "contact_first_source_before_erase()", "crm_deal_stage_moved()"]) {
      expect((await run("select has_function_privilege('harvest_app', $1, 'EXECUTE') as app, has_function_privilege('public', $1, 'EXECUTE') as pub", [`public.${fn}`])).rows[0], fn).toEqual({ app: false, pub: false });
      expect((await run("select proconfig from pg_proc where oid = $1::regprocedure", [`public.${fn}`])).rows[0].proconfig).toEqual(["search_path=pg_catalog, pg_temp"]);
    }
    const rows = (user: string, role: "contacts:read" | "opportunities:read", table: string) => withTenant(f.db, user, tenant, role, async (tx) => (await tx.execute(`select * from ${table}` as never)).rows.length);
    await run("insert into crm_deal_stage_moves(tenant_id, deal_id, from_stage_id, to_stage_id) select tenant_id, id, stage_id, stage_id from opportunities where tenant_id = $1 limit 0", [tenant]);
    expect(await rows("member", "contacts:read", "public.contact_first_sources")).toBe(0);
    expect(await rows("viewer", "opportunities:read", "public.crm_deal_stage_moves")).toBe(0);
    await expect(withTenant(f.db, "owner", tenant, "contacts:write", async (tx) => tx.execute(`insert into public.contact_first_sources(tenant_id, contact_id, kind, first_seen_at) values ('${tenant}', gen_random_uuid(), 'manual', now())` as never))).rejects.toThrow();
  });
});

describe("ministry time zone", () => {
  it("defaults to UTC, takes a valid browser zone at creation and falls back to UTC for anything else", async () => {
    expect((await getWorkspace(f.db, "owner", tenant)).timeZone).toBe("UTC");
    const berlin = (await createWorkspace(f.db, "owner", "Berlin church", "church", "Europe/Berlin")).tenantId;
    expect((await getWorkspace(f.db, "owner", berlin)).timeZone).toBe("Europe/Berlin");
    for (const bad of ["Mars/Olympus", "EST", "", 42, undefined]) expect((await getWorkspace(f.db, "owner", (await createWorkspace(f.db, "owner", "Fallback", "church", bad)).tenantId)).timeZone).toBe("UTC");
  });
  it("lets owners and admins change it, validates it, audits it and keeps ministries apart", async () => {
    const result = await updateWorkspaceTimeZone(f.db, "admin", tenant, { timeZone: "Pacific/Auckland" });
    expect(result?.timeZone).toBe("Pacific/Auckland");
    expect((await getWorkspace(f.db, "owner-b", other)).timeZone).toBe("UTC");
    for (const user of ["member", "viewer", "outsider"]) await expect(updateWorkspaceTimeZone(f.db, user, tenant, { timeZone: "UTC" })).rejects.toMatchObject({ status: 403 });
    for (const bad of ["EST", "Mars/Olympus", "", "Europe/Berlin'; --"]) await expect(updateWorkspaceTimeZone(f.db, "owner", tenant, { timeZone: bad })).rejects.toThrow();
    await expect(updateWorkspaceTimeZone(f.db, "owner", tenant, { timeZone: "UTC", extra: 1 })).rejects.toThrow();
    const audit = (await run("select metadata from audit_logs where tenant_id = $1 and action = 'workspace.time_zone_update'", [tenant])).rows;
    expect(audit).toEqual([{ metadata: { timeZone: "Pacific/Auckland", previousTimeZone: "UTC" } }]);
    await updateWorkspaceTimeZone(f.db, "owner", tenant, { timeZone: "UTC" });
  });
  it("computes the periods in the ministry zone: a deal made late on 30 November UTC is in December in Auckland", async () => {
    const auckland = (await createWorkspace(f.db, "owner", "Auckland church", "church", "Pacific/Auckland")).tenantId;
    const utc = (await createWorkspace(f.db, "owner-b", "UTC church", "church")).tenantId;
    const at = (ministry: string, user: string) => async () => {
      const owned = await createCompany(f.db, user, ministry, { name: "Synthetic" });
      for (let n = 0; n < 5; n++) { const deal = await createDeal(f.db, user, ministry, { name: `Late ${n}`, companyId: owned.id }); await backdate("update opportunities set created_at = '2026-11-30T20:00:00Z' where id = $1", [deal.id]); }
    };
    await at(auckland, "owner")(); await at(utc, "owner-b")();
    const december = new Date("2026-12-01T05:00:00Z"); // 18:00 on 1 December in Auckland; 05:00 in UTC
    const local = await getCrmReport(f.db, "owner", auckland, "thisMonth", december), plain = await getCrmReport(f.db, "owner-b", utc, "thisMonth", december);
    expect(local.timeZone).toBe("Pacific/Auckland");
    expect(local.deals.created).toBe(5);
    expect(local.window.start).toBe("2026-11-30T11:00:00.000Z");
    expect(plain.timeZone).toBe("UTC");
    expect(plain.deals.created).toBe(0);
    expect((await getCrmReport(f.db, "owner-b", utc, "lastMonth", december)).deals.created).toBe(5);
    expect((await getCrmReport(f.db, "owner", auckland, "lastMonth", december)).deals.created).toBe(0);
  });
});

describe("durable first source", () => {
  const born = async (name: string) => (await createContact(f.db, "owner", tenant, { name }));
  const durable = async (id: string) => (await run("select kind, first_seen_at from contact_first_sources where contact_id = $1", [id])).rows;
  it("records the manual source for a new person with no content beyond kind and date", async () => {
    const person = await born("Synthetic manual");
    const rows = await durable(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("manual");
    expect(Object.keys((await run("select * from contact_first_sources limit 1")).rows[0]).sort()).toEqual(["contact_id", "first_seen_at", "kind", "tenant_id"]);
  });
  it("lets a later source replace the provisional manual one, and keeps the earliest of several", async () => {
    const person = await born("Synthetic two sources");
    await inTenant(tenant, "delete from contact_source_events where contact_id = $1", [person.id]);
    expect(await durable(person.id)).toEqual([]);
    const event = (when: string) => inTenant(tenant, "insert into contact_source_events(tenant_id,contact_id,kind,outcome,occurred_at) values ($1,$2,'manual','created',$3)", [tenant, person.id, when]);
    await event("2026-10-10T00:00:00Z");
    expect((await durable(person.id))[0].first_seen_at).toEqual(new Date("2026-10-10T00:00:00Z"));
    await event("2026-10-05T00:00:00Z");
    expect((await durable(person.id))[0].first_seen_at).toEqual(new Date("2026-10-05T00:00:00Z"));
    await event("2026-10-20T00:00:00Z");
    expect((await durable(person.id))[0].first_seen_at).toEqual(new Date("2026-10-05T00:00:00Z"));
  });
  it("survives the deletion of the evidence and is gone with the person", async () => {
    const person = await born("Synthetic expiring");
    await run("update contact_first_sources set kind = 'connect', first_seen_at = '2026-10-01T00:00:00Z' where contact_id = $1", [person.id]); // as if a Connect response had credited it
    await run("alter table contact_source_events disable trigger contact_first_source_manual_removed");
    await run("delete from contact_source_events where contact_id = $1", [person.id]);
    await run("alter table contact_source_events enable trigger contact_first_source_manual_removed");
    expect(await durable(person.id)).toEqual([{ kind: "connect", first_seen_at: new Date("2026-10-01T00:00:00Z") }]);
    await eraseContact(f.db, "owner", tenant, person.id);
    expect(await durable(person.id)).toEqual([]);
  });
  it("removes the provisional manual credit whatever tenant context the caller has, and puts the caller's context back", async () => {
    const person = await born("Synthetic other context");
    expect(await durable(person.id)).toHaveLength(1);
    const client = await f.admin.connect();
    try {
      await client.query("begin");
      await client.query("select set_config('app.tenant_id', $1, true)", [other]); // the caller is working in another ministry
      await client.query("delete from contact_source_events where contact_id = $1", [person.id]);
      expect((await client.query("select current_setting('app.tenant_id', true) as t")).rows[0].t).toBe(other);
      await client.query("commit");
    } finally { client.release(); }
    expect(await durable(person.id)).toEqual([]);
  });
  it("keeps the earliest source on the kept person when two people merge", async () => {
    const keep = await born("Synthetic keep"), drop = await born("Synthetic drop");
    await run("update contact_first_sources set kind = 'manual', first_seen_at = '2026-10-20T00:00:00Z' where contact_id = $1", [keep.id]);
    await run("update contact_first_sources set kind = 'connect', first_seen_at = '2026-10-02T00:00:00Z' where contact_id = $1", [drop.id]);
    await mergeContacts(f.db, "owner", tenant, keep.id, { sourceId: drop.id, targetVersion: keep.version, sourceVersion: drop.version });
    expect(await durable(keep.id)).toEqual([{ kind: "connect", first_seen_at: new Date("2026-10-02T00:00:00Z") }]);
    expect(await durable(drop.id)).toEqual([]);
    const later = await born("Synthetic later"), earlier = await born("Synthetic earlier");
    await run("update contact_first_sources set kind = 'form', first_seen_at = '2026-10-01T00:00:00Z' where contact_id = $1", [later.id]);
    await run("update contact_first_sources set kind = 'csv_import', first_seen_at = '2026-10-09T00:00:00Z' where contact_id = $1", [earlier.id]);
    await mergeContacts(f.db, "owner", tenant, later.id, { sourceId: earlier.id, targetVersion: later.version, sourceVersion: earlier.version });
    expect(await durable(later.id)).toEqual([{ kind: "form", first_seen_at: new Date("2026-10-01T00:00:00Z") }]);
  });
  it("is readable by owners and admins of the same ministry only", async () => {
    const person = await born("Synthetic visible");
    const read = (user: string, ministry: string) => withTenant(f.db, user, ministry, "workspace:read", async (tx) => (await tx.execute(`select contact_id from public.contact_first_sources where contact_id = '${person.id}'` as never)).rows.length);
    expect(await read("owner", tenant)).toBe(1);
    expect(await read("admin", tenant)).toBe(1);
    expect(await read("member", tenant)).toBe(0);
    expect(await read("viewer", tenant)).toBe(0);
    expect(await read("owner-b", other)).toBe(0);
  });
  it("credits the report with the durable kind and date after the evidence is gone, and reports Unknown only for people who never had a source", async () => {
    const ministry = (await createWorkspace(f.db, "owner-b", "Durable report")).tenantId;
    for (let n = 0; n < 5; n++) {
      const person = await createContact(f.db, "owner-b", ministry, { name: `Synthetic durable ${n}` });
      await run("update contact_first_sources set kind = 'connect' where contact_id = $1", [person.id]);
      await run("alter table contact_source_events disable trigger contact_first_source_manual_removed");
      await run("delete from contact_source_events where contact_id = $1", [person.id]);
      await run("alter table contact_source_events enable trigger contact_first_source_manual_removed");
    }
    const report = await getCrmReport(f.db, "owner-b", ministry, "last7", new Date(Date.now() + 1000));
    expect(report.contacts?.sources.find((row) => row.source === "connect")).toEqual({ source: "connect", added: 5, withDeal: 0 });
    expect(report.contacts?.sources.find((row) => row.source === "unknown")).toEqual({ source: "unknown", added: 0, withDeal: 0 });
  });
});

describe("stage movement", () => {
  const dealIn = async (from: number, to: number, ministry = tenant, user = "owner") => {
    const owned = ministry === tenant ? company : (await createCompany(f.db, user, ministry, { name: "Synthetic other" })).id;
    const created = await createDeal(f.db, user, ministry, { name: "Moving", companyId: owned, stageId: (await listPipelines(f.db, user, ministry))[0]!.stages[from]!.id });
    const moved = await moveDeal(f.db, user, ministry, created.id, { stageId: (await listPipelines(f.db, user, ministry))[0]!.stages[to]!.id, version: created.version });
    return { id: created.id, version: moved.version };
  };
  it("records one row per stage change with no content, and nothing for a no-op or an edit", async () => {
    const before = await count("select count(*) as n from crm_deal_stage_moves where tenant_id = $1", [tenant]);
    const deal = await dealIn(0, 1);
    expect((await run("select from_stage_id, to_stage_id, moved_by from crm_deal_stage_moves where deal_id = $1", [deal.id])).rows).toEqual([{ from_stage_id: stage[0], to_stage_id: stage[1], moved_by: "owner" }]);
    expect(Object.keys((await run("select * from crm_deal_stage_moves limit 1")).rows[0]).sort()).toEqual(["deal_id", "from_stage_id", "id", "moved_at", "moved_by", "tenant_id", "to_stage_id"]);
    const same = await moveDeal(f.db, "owner", tenant, deal.id, { stageId: stage[1]!, version: deal.version });
    const edited = await updateDeal(f.db, "owner", tenant, deal.id, { name: "Renamed", version: same.version });
    expect(edited.version).toBeGreaterThan(same.version);
    expect(await count("select count(*) as n from crm_deal_stage_moves where tenant_id = $1", [tenant])).toBe(before + 1);
    await run("delete from crm_deal_stage_moves where deal_id = $1", [deal.id]); // keep the figures below exact
  });
  it("reports counts and the median time in stage, withholds a small step and its median, and shows an unused step as zero", async () => {
    await run("delete from crm_deal_stage_moves where tenant_id = $1", [tenant]);
    for (let n = 0; n < 5; n++) { const deal = await dealIn(0, 1); await backdate("update opportunities set created_at = '2026-11-14T12:00:00Z' where id = $1", [deal.id]); await run("update crm_deal_stage_moves set moved_at = '2026-11-18T12:00:00Z' where deal_id = $1", [deal.id]); }
    for (let n = 0; n < 3; n++) { const deal = await dealIn(1, 2); await run("update crm_deal_stage_moves set moved_at = '2026-11-18T12:00:00Z' where deal_id = $1", [deal.id]); }
    const report = await getCrmReport(f.db, "owner", tenant, "last7", now), pairs = report.stages!.pairs;
    expect(pairs).toHaveLength(stage.length - 2); // Won to Lost (two closed stages) is not listed
    expect(pairs.map((pair) => `${pair.from}>${pair.to}`)).not.toContain("Won>Lost");
    expect(pairs.at(-1)).toMatchObject({ to: "Won" });
    expect(pairs[0]).toMatchObject({ moved: 5, medianDays: 4 });
    expect(pairs[1]).toMatchObject({ moved: null, medianDays: null });
    expect(pairs[2]).toMatchObject({ moved: 0, medianDays: null });
    expect(report.stages!.trackedFrom).toBe("2026-11-18T12:00:00.000Z");
    const outside = await getCrmReport(f.db, "owner", tenant, "lastMonth", now);
    expect(outside.stages!.pairs[0]).toMatchObject({ moved: 0 });
  });
  it("measures time in stage from the previous move of the same deal and ignores archived deals and other ministries", async () => {
    await run("delete from crm_deal_stage_moves where tenant_id = $1", [tenant]);
    for (let n = 0; n < 5; n++) {
      const deal = await dealIn(0, 1); const next = await moveDeal(f.db, "owner", tenant, deal.id, { stageId: stage[2]!, version: deal.version });
      await backdate("update opportunities set created_at = '2026-11-10T00:00:00Z' where id = $1", [deal.id]);
      await run("update crm_deal_stage_moves set moved_at = '2026-11-12T00:00:00Z' where deal_id = $1 and to_stage_id = $2", [deal.id, stage[1]]);
      await run("update crm_deal_stage_moves set moved_at = '2026-11-18T00:00:00Z' where deal_id = $1 and to_stage_id = $2", [deal.id, stage[2]]);
      if (n === 0) await updateDeal(f.db, "owner", tenant, deal.id, { archived: true, version: next.version });
    }
    for (let n = 0; n < 6; n++) await dealIn(0, 1, other, "owner-b");
    const pairs = (await getCrmReport(f.db, "owner", tenant, "last30", now)).stages!.pairs;
    expect(pairs[0]).toMatchObject({ moved: null }); // 4 live deals: archived one excluded
    expect(pairs[1]).toMatchObject({ moved: null });
    for (let n = 0; n < 2; n++) { const deal = await dealIn(0, 1); await moveDeal(f.db, "owner", tenant, deal.id, { stageId: stage[2]!, version: deal.version }); await run("update crm_deal_stage_moves set moved_at = '2026-11-12T00:00:00Z' where deal_id = $1 and to_stage_id = $2", [deal.id, stage[1]]); await run("update crm_deal_stage_moves set moved_at = '2026-11-18T00:00:00Z' where deal_id = $1 and to_stage_id = $2", [deal.id, stage[2]]); await backdate("update opportunities set created_at = '2026-11-10T00:00:00Z' where id = $1", [deal.id]); }
    const wider = (await getCrmReport(f.db, "owner", tenant, "last30", now)).stages!.pairs;
    expect(wider[1]).toMatchObject({ moved: 6, medianDays: 6 }); // 18 Nov minus 12 Nov
    expect(wider[0]).toMatchObject({ moved: 6, medianDays: 2 }); // 12 Nov minus creation on 10 Nov
    const foreign = (await getCrmReport(f.db, "owner-b", other, "last7", now)).stages!.pairs;
    expect(foreign[0]!.moved === null || foreign[0]!.moved <= 6).toBe(true);
  });
  it("shows no stage figures to members, nothing to viewers, and is readable by admins", async () => {
    expect((await getCrmReport(f.db, "member", tenant, "last7", now)).stages).toBeUndefined();
    await expect(getCrmReport(f.db, "viewer", tenant, "last7", now)).rejects.toMatchObject({ status: 403 });
    expect((await getCrmReport(f.db, "admin", tenant, "last7", now)).stages?.pairs.length).toBeGreaterThan(0);
  });
  it("never blocks erasing or merging a person who has deals, and keeps the moves (they hold no personal data)", async () => {
    const one = await createContact(f.db, "owner", tenant, { name: "Synthetic erased with deal" }), two = await createContact(f.db, "owner", tenant, { name: "Synthetic merged with deal" });
    const deal = await createDeal(f.db, "owner", tenant, { name: "Contact deal", contactId: one.id, stageId: stage[0] });
    await moveDeal(f.db, "owner", tenant, deal.id, { stageId: stage[1]!, version: deal.version });
    const keeper = await createContact(f.db, "owner", tenant, { name: "Synthetic keeper" });
    const second = await createDeal(f.db, "owner", tenant, { name: "Second deal", contactId: two.id, stageId: stage[0] });
    await moveDeal(f.db, "owner", tenant, second.id, { stageId: stage[1]!, version: second.version });
    await mergeContacts(f.db, "owner", tenant, keeper.id, { sourceId: two.id, targetVersion: keeper.version, sourceVersion: two.version });
    await eraseContact(f.db, "owner", tenant, one.id);
    expect(await count("select count(*) as n from crm_deal_stage_moves where deal_id in ($1, $2)", [deal.id, second.id])).toBe(2);
  });
  it("does not let a move fail because the actor is not a known user", async () => {
    const deal = await createDeal(f.db, "owner", tenant, { name: "System move", companyId: company, stageId: stage[0] });
    await run("select set_config('app.tenant_id', $1, false)", [tenant]);
    await run("select set_config('app.user_id', 'no-such-user', false)");
    await run("update opportunities set stage_id = $2 where id = $1", [deal.id, stage[1]]);
    await run("reset app.tenant_id"); await run("reset app.user_id");
    expect((await run("select moved_by from crm_deal_stage_moves where deal_id = $1", [deal.id])).rows).toEqual([{ moved_by: null }]);
  });
});

describe("export", () => {
  const route = async (user: string | null, search: string, ministry = tenant) => {
    const { GET } = await import("../../src/app/api/workspaces/[tenantId]/crm/reports/export/route");
    return GET(new Request(`http://localhost/api/workspaces/${ministry}/crm/reports/export${search}`, { headers: user ? { "x-test-user": user } : {} }), { params: Promise.resolve({ tenantId: ministry }) });
  };
  it("gives owners and admins a CSV of each table, audited with no content, and refuses everyone else", async () => {
    const before = await count("select count(*) as n from audit_logs where tenant_id = $1 and action = 'crm.report.export'", [tenant]);
    for (const table of ["deals", "tasks", "sources", "stages"]) {
      const ok = await route("owner", `?table=${table}&period=last30`);
      expect(ok.status, table).toBe(200);
      expect(ok.headers.get("Content-Type")).toContain("text/csv");
      expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
      expect(ok.headers.get("Content-Disposition")).toMatch(new RegExp(`crm-report-${table}-last30-\\d{4}-\\d{2}-\\d{2}\\.csv`));
      const body = await ok.text();
      expect(body.replace(/^\ufeff/, "").startsWith("Period start,Period end,Time zone,")).toBe(true);
      expect(body).not.toMatch(/Synthetic|@example|owner-b/);
    }
    expect((await route("admin", "?table=deals")).status).toBe(200);
    expect(await count("select count(*) as n from audit_logs where tenant_id = $1 and action = 'crm.report.export'", [tenant])).toBe(before + 5);
    const { rows: [row] } = await run("select actor_id, target_id, metadata from audit_logs where tenant_id = $1 and action = 'crm.report.export' order by created_at desc limit 1", [tenant]);
    expect(row).toEqual({ actor_id: "admin", target_id: null, metadata: { table: "deals", period: "last30" } });
    expect((await route(null, "?table=deals")).status).toBe(401);
    for (const user of ["member", "viewer", "outsider"]) expect((await route(user, "?table=deals")).status, user).toBe(403);
    expect((await route("owner-b", "?table=deals")).status).toBe(403);
    expect((await route("owner", "?table=people")).status).toBe(400);
    expect((await route("owner", "?table=deals&period=last365")).status).toBe(400);
    expect((await route("owner", "")).status).toBe(400);
    expect(await count("select count(*) as n from audit_logs where tenant_id = $1 and action = 'crm.report.export'", [tenant])).toBe(before + 5);
  });
  it("applies the small-cohort rule and the ministry time zone", async () => {
    const zoned = (await createWorkspace(f.db, "owner", "Export zone", "church", "Pacific/Auckland")).tenantId;
    const owned = await createCompany(f.db, "owner", zoned, { name: "Synthetic" });
    for (let n = 0; n < 3; n++) await createDeal(f.db, "owner", zoned, { name: `Few ${n}`, companyId: owned.id });
    const file = await exportCrmReportTable(f.db, "owner", zoned, "last7", "deals", new Date("2026-12-01T05:00:00Z"));
    expect(file.fileName).toBe("crm-report-deals-last7-2026-12-01.csv");
    expect(file.body).toContain("Pacific/Auckland");
    expect(file.body).not.toMatch(/,[1-4]\r\n/);
    const report = await getCrmReport(f.db, "owner", zoned, "last7", new Date("2026-12-01T05:00:00Z"));
    expect(report.deals.open).toBeNull();
    expect(file.body).toContain(",Open,Fewer than 5\r\n");
  });
});
