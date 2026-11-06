import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { eraseContact } from "../../src/server/contacts";
import { patchRecordFields } from "../../src/server/crm-fields";
import { findView } from "../../src/server/crm-views";
import { createDeal, listDeals, listPipelines, moveDeal } from "../../src/server/crm-deals";
import { dealQuery } from "../../src/lib/crm-deals";

it("upgrades a post-CRM-03 database: people, companies, custom values and views survive and gain pipelines and deals", async () => {
  const tenant = "99999999-9999-4999-8999-999999999999", person = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", company = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const field = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", view = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const fixture = await testDatabase({ beforeCrm04Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(15);
    await admin.query("insert into users (id,name,email) values ('crm04-upgrade','Owner','crm04-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM-04 upgrade','crm04-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm04-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name,version) values ($1,$2,'Existing Person',2)", [tenant, person]);
    await admin.query("select set_config('app.user_id','crm04-upgrade',false)");
    try {
      await admin.query("insert into companies (tenant_id,id,name,created_by) values ($1,$2,'Existing Org','crm04-upgrade')", [tenant, company]);
      await admin.query("insert into crm_field_definitions (tenant_id,id,object_type,key,label,type,created_by) values ($1,$2,'person','note','Note','text','crm04-upgrade')", [tenant, field]);
      await admin.query("insert into crm_field_values (tenant_id,field_id,object_type,contact_id,value_text,updated_by) values ($1,$2,'person',$3,'kept','crm04-upgrade')", [tenant, field, person]);
      await admin.query("insert into crm_saved_views (tenant_id,id,object_type,name,state,created_by) values ($1,$2,'person','Shared','{\"q\":\"\",\"sort\":\"name\",\"filters\":[],\"columns\":null,\"density\":\"compact\"}','crm04-upgrade')", [tenant, view]);
    } finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    expect((await findView(fixture.db, "crm04-upgrade", tenant, "person", view))?.state.density).toBe("compact");
    expect((await patchRecordFields(fixture.db, "crm04-upgrade", tenant, "person", person, { version: 2, values: { note: "changed" } })).version).toBe(3);
    // No backfill: the default pipeline is created the first time a writer opens Pipelines.
    expect((await fixture.admin.query("select count(*)::int as n from crm_pipelines")).rows[0].n).toBe(0);
    const [pipeline] = await listPipelines(fixture.db, "crm04-upgrade", tenant);
    expect(pipeline.stages.map((stage) => stage.key)).toEqual(["new", "contacted", "qualified", "proposal", "won", "lost"]);
    const deal = await createDeal(fixture.db, "crm04-upgrade", tenant, { name: "Upgrade deal", contactId: person, companyId: company, amount: "1200" });
    const moved = await moveDeal(fixture.db, "crm04-upgrade", tenant, deal.id, { stageId: pipeline.stages[1].id, version: deal.version });
    expect(moved.version).toBe(2);
    await eraseContact(fixture.db, "crm04-upgrade", tenant, person);
    const board = await listDeals(fixture.db, "crm04-upgrade", tenant, null, dealQuery.parse({}));
    expect(board.deals).toMatchObject([{ id: deal.id, contactId: null, companyId: company, version: 3 }]);
    expect(JSON.stringify((await fixture.admin.query("select * from opportunities")).rows)).not.toContain(person);
  } finally { await fixture.close(); }
});
