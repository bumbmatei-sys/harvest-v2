import { expect, it } from "vitest";
import { migrationCount, testDatabase } from "../database";
import { getContact, recordConsent } from "../../src/server/contacts";
import { getTimeline } from "../../src/server/activity";
import { recordAssociation } from "../../src/server/crm-associations";
import { mergeContacts } from "../../src/server/crm-merge";

it("upgrades a post-CRM-06 database: existing consents keep their purposes, then associations record, show and move on merge", async () => {
  const tenant = "57575757-5757-4757-8757-575757575757", person = "68686868-6868-4868-8868-686868686868", twin = "79797979-7979-4979-8979-797979797979";
  const fixture = await testDatabase({ beforeCrm07Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(24);
    expect((await admin.query("select to_regclass('public.crm_associations') is null as absent")).rows[0].absent).toBe(true);
    await admin.query("insert into users (id,name,email) values ('crm07-upgrade','Owner','crm07-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'CRM-07 upgrade','crm07-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'crm07-upgrade','owner')", [tenant]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Existing Person'),($1,$3,'Existing Person')", [tenant, person, twin]);
    await admin.query("select set_config('app.user_id','crm07-upgrade',false)");
    try {
      await admin.query(`insert into contact_consents (tenant_id,contact_id,channel,status,purpose,notice_version,source,evidence,recorded_by,occurred_at)
      values ($1,$2,'email','granted','marketing','notice-v1','Existing form','Synthetic evidence','crm07-upgrade',now())`, [tenant, person]);
    } finally { await admin.query("select set_config('app.user_id','',false)"); }
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    // The pre-existing marketing consent is untouched and still the person's only decision.
    expect((await getContact(fixture.db, "crm07-upgrade", tenant, person)).consents.map((consent) => [consent.purpose, consent.status])).toEqual([["marketing", "granted"]]);
    // A marketing grant is not a messaging grant: nothing is stored until messaging consent exists.
    expect(await recordAssociation(fixture.db, "crm07-upgrade", tenant, { source: "form", kind: "form_submission", purpose: "messaging", contactId: twin, summary: "Synthetic" })).toMatchObject({ stored: false });
    await recordConsent(fixture.db, "crm07-upgrade", tenant, twin, { channel: "email", status: "granted", purpose: "messaging", noticeVersion: "notice-v1", source: "Synthetic", evidence: "Synthetic evidence" });
    const stored = await recordAssociation(fixture.db, "crm07-upgrade", tenant, { source: "form", kind: "form_submission", purpose: "messaging", contactId: twin, summary: "Synthetic upgrade form" });
    if (!stored.stored) throw new Error("association was not stored");
    const [kept, merged] = [await getContact(fixture.db, "crm07-upgrade", tenant, person), await getContact(fixture.db, "crm07-upgrade", tenant, twin)];
    expect((await mergeContacts(fixture.db, "crm07-upgrade", tenant, person, { sourceId: twin, targetVersion: kept.version, sourceVersion: merged.version })).moved).toMatchObject({ activities: 1 });
    expect((await getTimeline(fixture.db, "crm07-upgrade", tenant, "person", person)).items.some((item) => item.kind === "association" && item.associationId === stored.id)).toBe(true);
  } finally { await fixture.close(); }
});
