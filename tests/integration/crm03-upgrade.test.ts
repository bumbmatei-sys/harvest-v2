import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { eraseContact, getContact, listContacts } from "../../src/server/contacts";
import { createFieldDefinition, patchRecordFields } from "../../src/server/crm-fields";
import { createView, findView } from "../../src/server/crm-views";
import { fullState } from "../../src/lib/crm-fields";

it("upgrades a post-CRM-02 database: people, companies and links survive and gain custom fields and views", async () => {
  const tenant = "66666666-6666-4666-8666-666666666666", person = "77777777-7777-4777-8777-777777777777", company = "88888888-8888-4888-8888-888888888888";
  const fixture = await testDatabase({ beforeCrm03Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(13);
    await admin.query("insert into users (id,name,email) values ('crm03-upgrade','Owner','crm03-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM-03 upgrade','crm03-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm03-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name,version) values ($1,$2,'Existing Person',3)", [tenant, person]);
    await admin.query("select set_config('app.user_id','crm03-upgrade',false)");
    try {
      await admin.query("insert into companies (tenant_id,id,name,domain,created_by) values ($1,$2,'Existing Org','existing.example','crm03-upgrade')", [tenant, company]);
      await admin.query("insert into contact_company_links (tenant_id,contact_id,company_id,is_primary,created_by) values ($1,$2,$3,true,'crm03-upgrade')", [tenant, person, company]);
    } finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    const before = await getContact(fixture.db, "crm03-upgrade", tenant, person);
    expect(before).toMatchObject({ version: 3, companies: [{ companyId: company, isPrimary: true }] });
    // CRM-02 shareable URLs keep working after the upgrade.
    expect((await listContacts(fixture.db, "crm03-upgrade", tenant, { company })).total).toBe(1);
    await createFieldDefinition(fixture.db, "crm03-upgrade", tenant, { objectType: "person", label: "Sponsor", type: "relation", relationTarget: "person" });
    await createFieldDefinition(fixture.db, "crm03-upgrade", tenant, { objectType: "person", label: "Tier", type: "select", options: [{ value: "gold", label: "Gold" }] });
    expect((await patchRecordFields(fixture.db, "crm03-upgrade", tenant, "person", person, { version: 3, values: { tier: "gold" } })).version).toBe(4);
    const view = await createView(fixture.db, "crm03-upgrade", tenant, { objectType: "person", name: "Gold", shared: true, state: fullState({ filters: [{ field: "cf:tier", op: "any_of", value: ["gold"] }], columns: ["company", "cf:tier"] }) });
    expect((await listContacts(fixture.db, "crm03-upgrade", tenant, { f: "cf:tier~any_of~gold" })).rows[0].custom).toEqual({ tier: "gold" });
    await eraseContact(fixture.db, "crm03-upgrade", tenant, person);
    expect((await fixture.admin.query("select count(*)::int as n from crm_field_values")).rows[0].n).toBe(0);
    expect((await findView(fixture.db, "crm03-upgrade", tenant, "person", view.id))?.state.columns).toEqual(["company", "cf:tier"]);
    expect(JSON.stringify((await fixture.admin.query("select * from contacts")).rows)).not.toContain(person);
  } finally { await fixture.close(); }
});
