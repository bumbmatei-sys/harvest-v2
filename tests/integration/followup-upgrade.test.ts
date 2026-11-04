import { expect, it } from "vitest";
import { testDatabase } from "../database";

it("upgrades 0007, scrubs previously erased audit targets and preserves live history", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const contact = "22222222-2222-4222-8222-222222222222";
  const live = "33333333-3333-4333-8333-333333333333";
  const fixture = await testDatabase({ beforeFollowupMigration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(8);
    await admin.query("insert into users (id,name,email) values ('upgrade-owner','Owner','upgrade-owner@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Upgrade','upgrade-owner')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'upgrade-owner','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Erase'),($1,$3,'Live')", [tenant, contact, live]);
    await admin.query("insert into audit_logs (tenant_id,actor_id,action,target_id,metadata) values ($1,'upgrade-owner','contact.consent_record',$2,'{\"consentId\":\"old-consent\",\"channel\":\"email\",\"status\":\"withdrawn\"}'),($1,'upgrade-owner','contact.create',$3,'{}')", [tenant, contact, live]);
    await admin.query("select set_config('app.tenant_id',$1,false),set_config('app.user_id','upgrade-owner',false)", [tenant]);
    try { await admin.query("select public.erase_contact($1,$2)", [tenant, contact]); }
    finally { await admin.query("select set_config('app.tenant_id','',false),set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(9);
    const audits = (await fixture.admin.query("select action,target_id,metadata from audit_logs where tenant_id=$1 order by action", [tenant])).rows;
    expect(audits).toEqual([
      { action: "contact.consent_record", target_id: null, metadata: {} },
      { action: "contact.create", target_id: live, metadata: {} },
      { action: "contact.erase", target_id: null, metadata: {} },
    ]);
    expect((await fixture.admin.query("select policyname from pg_policies where policyname='migration_backfill'")).rows).toEqual([]);
  } finally { await fixture.close(); }
});
