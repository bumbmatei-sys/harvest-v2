import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { companies } from "../../src/db/schema";
import { createCompany } from "../../src/server/companies";
import { eraseContact, getContact, linkCompany, patchContact } from "../../src/server/contacts";
import { withTenant } from "../../src/server/tenancy";

it("upgrades a 0010 database: existing people and consent survive, gain versions, and erase with links", async () => {
  const tenant = "44444444-4444-4444-8444-444444444444", person = "55555555-5555-4555-8555-555555555555";
  const fixture = await testDatabase({ beforeCrmMigration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(11);
    await admin.query("insert into users (id,name,email) values ('crm-upgrade','Owner','crm-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM upgrade','crm-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'  Pre   Existing Person ')", [tenant, person]);
    await admin.query("insert into contact_identifiers (tenant_id,contact_id,kind,value,normalized_value) values ($1,$2,'email','pre@example.test','pre@example.test')", [tenant, person]);
    await admin.query("select set_config('app.user_id','crm-upgrade',false)");
    try { await admin.query("insert into contact_consents (tenant_id,contact_id,recorded_by,purpose,notice_version,channel,status,source,evidence) values ($1,$2,'crm-upgrade','marketing','notice-v1','email','granted','Synthetic','Synthetic')", [tenant, person]); }
    finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    const before = await getContact(fixture.db, "crm-upgrade", tenant, person);
    expect(before).toMatchObject({ version: 1, normalizedName: "pre existing person", companies: [] });
    expect(before.consents).toHaveLength(1);
    await patchContact(fixture.db, "crm-upgrade", tenant, person, { notes: "Upgraded", version: 1 });
    const company = await createCompany(fixture.db, "crm-upgrade", tenant, { name: "Upgrade Org", domain: "upgrade.example" });
    await linkCompany(fixture.db, "crm-upgrade", tenant, person, { companyId: company.id });
    await eraseContact(fixture.db, "crm-upgrade", tenant, person);
    expect((await fixture.admin.query("select count(*)::int as n from contact_company_links")).rows[0].n).toBe(0);
    expect((await fixture.admin.query("select count(*)::int as n from contact_consents where redacted_at is not null")).rows[0].n).toBe(1);
    expect(await withTenant(fixture.db, "crm-upgrade", tenant, "companies:read", (tx) => tx.select().from(companies))).toHaveLength(1);
    expect(JSON.stringify((await fixture.admin.query("select * from audit_logs")).rows)).not.toContain(person);
  } finally { await fixture.close(); }
});
