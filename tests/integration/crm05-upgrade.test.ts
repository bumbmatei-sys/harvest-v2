import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { eraseContact } from "../../src/server/contacts";
import { getDeal, listDeals, moveDeal } from "../../src/server/crm-deals";
import { createNote, createTask, getTask } from "../../src/server/crm-tasks";
import { getTimeline } from "../../src/server/activity";
import { dealQuery } from "../../src/lib/crm-deals";

it("upgrades a post-CRM-04 database: deals, pipelines and ledger history survive and gain tasks, notes and the unified timeline", async () => {
  const tenant = "12121212-1212-4212-8212-121212121212", person = "34343434-3434-4434-8434-343434343434", company = "56565656-5656-4656-8656-565656565656";
  const pipeline = "78787878-7878-4878-8878-787878787878", stageNew = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a", stageWon = "bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc", deal = "dededede-dede-4ede-8ede-dededededede";
  const fixture = await testDatabase({ beforeCrm05Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(18);
    await admin.query("insert into users (id,name,email) values ('crm05-upgrade','Owner','crm05-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM-05 upgrade','crm05-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm05-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Existing Person')", [tenant, person]);
    await admin.query("select set_config('app.user_id','crm05-upgrade',false)");
    try {
      await admin.query("insert into companies (tenant_id,id,name,created_by) values ($1,$2,'Existing Org','crm05-upgrade')", [tenant, company]);
      await admin.query("insert into crm_pipelines (tenant_id,id,name,is_default,created_by) values ($1,$2,'Pipeline',true,'crm05-upgrade')", [tenant, pipeline]);
      await admin.query("insert into crm_pipeline_stages (tenant_id,id,pipeline_id,key,name,kind,position,created_by) values ($1,$2,$3,'new','New','open',0,'crm05-upgrade'),($1,$4,$3,'won','Won','won',1,'crm05-upgrade')", [tenant, stageNew, pipeline, stageWon]);
      await admin.query("insert into opportunities (tenant_id,id,name,pipeline_id,stage_id,amount,company_id,contact_id,created_by) values ($1,$2,'Existing deal',$3,$4,500,$5,$6,'crm05-upgrade')", [tenant, deal, pipeline, stageNew, company, person]);
      await admin.query("insert into audit_logs (tenant_id,actor_id,action,target_id,metadata) values ($1,'crm05-upgrade','opportunity.create',$2,$3)", [tenant, deal, JSON.stringify({ toStageId: stageNew })]);
    } finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    expect((await listDeals(fixture.db, "crm05-upgrade", tenant, null, dealQuery.parse({}))).deals.map((item) => item.id)).toEqual([deal]);
    const moved = await moveDeal(fixture.db, "crm05-upgrade", tenant, deal, { stageId: stageWon, version: 1 });
    expect(moved.version).toBe(2);
    const task = await createTask(fixture.db, "crm05-upgrade", tenant, { title: "Thank them", opportunityId: deal, contactId: person, assigneeUserId: "crm05-upgrade" });
    await createNote(fixture.db, "crm05-upgrade", tenant, { target: "deal", targetId: deal, body: "Closed at the dinner" });
    const actions = (await getTimeline(fixture.db, "crm05-upgrade", tenant, "deal", deal)).items.map((item) => (item.kind === "note" ? "note" : item.action));
    expect(actions).toEqual(["note", "task.create", "opportunity.move", "opportunity.create"]);
    await eraseContact(fixture.db, "crm05-upgrade", tenant, person);
    expect(await getTask(fixture.db, "crm05-upgrade", tenant, task.id)).toMatchObject({ contactId: null, opportunityId: deal });
    expect((await getDeal(fixture.db, "crm05-upgrade", tenant, deal)).deal.contactId).toBeNull();
    expect(JSON.stringify((await fixture.admin.query("select metadata from audit_logs")).rows)).not.toContain(person);
  } finally { await fixture.close(); }
});
