import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { migrationCount, testDatabase } from "../database";
import { eraseContact, getContact } from "../../src/server/contacts";
import { getCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";
import { listPendingResponseSummaries } from "../../src/server/connect-responses";

it("upgrades a post-CRM-08 database: existing campaigns, people and erasure keep working, then Connect builds on them", async () => {
  const tenant = "26262626-2626-4626-8626-262626262626", campaign = "37373737-3737-4737-8737-373737373737", person = "48484848-4848-4848-8848-484848484848";
  const fixture = await testDatabase({ beforeHc02Migration: async (admin) => {
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(26);
    expect((await admin.query("select to_regclass('public.campaign_responses') is null and to_regclass('public.forms') is null as absent")).rows[0].absent).toBe(true);
    await admin.query("insert into users (id,name,email) values ('hc02-upgrade','Owner','hc02-upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'HC-02 upgrade','hc02-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'hc02-upgrade','owner')", [tenant]);
    await admin.query(`insert into campaigns (tenant_id,id,owner_user_id,type,name,idempotency_key,fingerprint) values ($1,$2,'hc02-upgrade','evangelistic_crusade','Existing crusade','existing',$3)`, [tenant, campaign, "b".repeat(64)]);
    await admin.query("insert into contacts (tenant_id,id,name) values ($1,$2,'Existing Person')", [tenant, person]);
    await admin.query("insert into contact_identifiers (tenant_id,contact_id,kind,value,normalized_value) values ($1,$2,'email','existing@example.test','existing@example.test')", [tenant, person]);
    await admin.query("insert into outbox_events (tenant_id,kind,idempotency_key,fingerprint,payload) values ($1,'crm.person.created','existing-person',$2,$3)", [tenant, "c".repeat(64), { contactId: person }]);
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(migrationCount);
    expect(migrationCount).toBe(27);
    expect(await getCampaign(fixture.db, "hc02-upgrade", tenant, campaign)).toMatchObject({ name: "Existing crusade", status: "draft" });
    expect((await getContact(fixture.db, "hc02-upgrade", tenant, person)).name).toBe("Existing Person");
    const { rows: forced } = await fixture.admin.query("select count(*)::int as count from pg_class where relname in ('forms','form_versions','privacy_notice_versions','campaign_response_links','campaign_responses','campaign_response_contact_methods','campaign_response_consents') and relforcerowsecurity");
    expect(forced[0].count).toBe(7);

    // Connect references the pre-existing campaign through the canonical composite key.
    const link = await withTenant(fixture.db, "hc02-upgrade", tenant, "workspace:read", async (tx) => {
      const [notice] = (await tx.execute(sql`insert into privacy_notice_versions (tenant_id,notice_key,version,locale,body,body_sha256,created_by) values (${tenant},'upgrade',1,'en','Synthetic upgrade notice',${"0".repeat(64)},'hc02-upgrade') returning id`)).rows as { id: string }[];
      const [form] = (await tx.execute(sql`insert into forms (tenant_id,name,created_by) values (${tenant},'Upgrade form','hc02-upgrade') returning id`)).rows as { id: string }[];
      const [version] = (await tx.execute(sql`insert into form_versions (tenant_id,form_id,version,offered_purposes,notice_version_id,pending_retention_days,created_by) values (${tenant},${form.id},1,'{outreach_follow_up}',${notice.id},14,'hc02-upgrade') returning id`)).rows as { id: string }[];
      await tx.execute(sql`update form_versions set status = 'published', published_by = 'hc02-upgrade' where id = ${version.id}`);
      const [created] = (await tx.execute(sql`insert into campaign_response_links (tenant_id,campaign_id,form_version_id,public_code,created_by) values (${tenant},${campaign},${version.id},${randomBytes(16).toString("hex")},'hc02-upgrade') returning id, form_version_id`)).rows as { id: string; form_version_id: string }[];
      return created;
    });
    await fixture.admin.query("update campaign_response_links set status = 'published' where id = $1", [link.id]);
    await fixture.admin.query("insert into campaign_responses (tenant_id,campaign_id,link_id,form_version_id,public_submission_id,preferred_name) values ($1,$2,$3,$4,$5,'Upgrade Guest')", [tenant, campaign, link.id, link.form_version_id, randomUUID()]);
    const summaries = await listPendingResponseSummaries(fixture.db, "hc02-upgrade", tenant, campaign);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].expiresAt!.getTime() - summaries[0].submittedAt.getTime()).toBe(14 * 24 * 3600 * 1000);

    // The replaced erase_contact still erases a pre-existing person and their durable references.
    expect(await eraseContact(fixture.db, "hc02-upgrade", tenant, person)).toEqual({ erased: true });
    expect((await fixture.admin.query("select payload from outbox_events where tenant_id = $1 and idempotency_key = 'existing-person'", [tenant])).rows[0].payload).toEqual({ contactId: null });
    expect((await fixture.admin.query("select count(*)::int as count from contact_identifiers where tenant_id = $1", [tenant])).rows[0].count).toBe(0);
  } finally { await fixture.close(); }
});
