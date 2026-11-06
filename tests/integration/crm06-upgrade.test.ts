import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { eraseContact, getContact, listContacts } from "../../src/server/contacts";
import { getTask } from "../../src/server/crm-tasks";
import { commitImport, createImport, previewImport, rollbackImport } from "../../src/server/crm-imports";
import { exportRecords } from "../../src/server/crm-export";
import { mergeContacts } from "../../src/server/crm-merge";

it("upgrades a post-CRM-05 database: people, tasks and notes survive, then import, export, merge and rollback work", async () => {
  const tenant = "13131313-1313-4313-8313-131313131313", person = "24242424-2424-4424-8424-242424242424", twin = "35353535-3535-4535-8535-353535353535", task = "46464646-4646-4646-8646-464646464646";
  const fixture = await testDatabase({ beforeCrm06Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(21);
    await admin.query("insert into users (id,name,email) values ('crm06-upgrade','Owner','crm06-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM-06 upgrade','crm06-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm06-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Existing Person'),($1,$3,'Existing Person')", [tenant, person, twin]);
    await admin.query("insert into contact_identifiers (tenant_id,contact_id,kind,value,normalized_value) values ($1,$2,'email','existing@example.test','existing@example.test')", [tenant, person]);
    await admin.query("select set_config('app.user_id','crm06-upgrade',false)");
    try {
      await admin.query("insert into crm_tasks (tenant_id,id,title,contact_id,created_by) values ($1,$2,'Existing task',$3,'crm06-upgrade')", [tenant, task, twin]);
      await admin.query("insert into crm_notes (tenant_id,body,contact_id,created_by) values ($1,'Existing note',$2,'crm06-upgrade')", [tenant, twin]);
    } finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    expect((await listContacts(fixture.db, "crm06-upgrade", tenant)).total).toBe(2);
    // Import against pre-existing data: the existing email is matched (skipped), the new row is created.
    const created = await createImport(fixture.db, "crm06-upgrade", tenant, { entity: "person", clientKey: randomUUID(), fileName: "upgrade.csv", csv: "Name,Email\nSomeone,EXISTING@example.test\nNew Person,new@example.test" });
    await previewImport(fixture.db, "crm06-upgrade", tenant, created.id, { version: created.version });
    expect((await commitImport(fixture.db, "crm06-upgrade", tenant, created.id)).stats).toMatchObject({ created: 1, skipped: 1 });
    const file = await exportRecords(fixture.db, "crm06-upgrade", tenant, "person");
    expect(file.rows).toBe(3);
    // Merge the pre-existing twin (with its CRM-05 task and note) into the person.
    const [kept, merged] = [await getContact(fixture.db, "crm06-upgrade", tenant, person), await getContact(fixture.db, "crm06-upgrade", tenant, twin)];
    expect((await mergeContacts(fixture.db, "crm06-upgrade", tenant, person, { sourceId: twin, targetVersion: kept.version, sourceVersion: merged.version })).moved).toMatchObject({ tasks: 1, notes: 1 });
    expect(await getTask(fixture.db, "crm06-upgrade", tenant, task)).toMatchObject({ contactId: person });
    expect((await rollbackImport(fixture.db, "crm06-upgrade", tenant, created.id)).result).toEqual({ removed: 1, reverted: 0, kept: 0 });
    await eraseContact(fixture.db, "crm06-upgrade", tenant, person);
    expect((await fixture.admin.query("select count(*)::int as n from crm_import_rows where tenant_id = $1 and raw::text like '%existing@%'", [tenant])).rows[0].n).toBe(0);
  } finally { await fixture.close(); }
});
