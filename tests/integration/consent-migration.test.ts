import { expect, it } from "vitest";
import { testDatabase } from "../database";

it("upgrades populated consent history, backfills known actors and labels unavailable legacy provenance", async () => {
  const fixture = await testDatabase({ beforeConsentUpgrade: async (admin) => {
    await admin.query("insert into users (id,name,email) values ('legacy-actor','Legacy','legacy@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ('11111111-1111-4111-8111-111111111111','Legacy','legacy-actor')");
    await admin.query("insert into contacts (tenant_id,id,name) values ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Legacy person')");
    await admin.query("insert into contact_consents (tenant_id,id,contact_id,channel,status,source,evidence,occurred_at) values ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','email','granted','Legacy form','Legacy evidence','2026-10-01T10:00:00Z'), ('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','email','withdrawn','Legacy request','Legacy evidence','2026-10-02T10:00:00Z')");
    await admin.query("insert into audit_logs (tenant_id,actor_id,action,target_id,metadata,created_at) values ('11111111-1111-4111-8111-111111111111','legacy-actor','contact.consent_record','22222222-2222-4222-8222-222222222222','{\"consentId\":\"33333333-3333-4333-8333-333333333333\"}','2026-10-01T10:00:01Z')");
  } });
  try {
    const { rows } = await fixture.admin.query("select * from contact_consents order by occurred_at");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ recorded_by: "legacy-actor", purpose: "legacy_unspecified", notice_version: "legacy-unversioned", occurred_at: new Date("2026-10-01T10:00:00Z"), recorded_at: new Date("2026-10-01T10:00:01Z"), source: "Legacy form", evidence: "Legacy evidence" });
    expect(rows[1]).toMatchObject({ recorded_by: null, purpose: "legacy_unspecified", notice_version: "legacy-unversioned", status: "withdrawn" });
    const { rows: policies } = await fixture.admin.query("select policyname from pg_policies where policyname = 'migration_backfill'");
    expect(policies).toEqual([]);
    await expect(fixture.admin.query("update contact_consents set evidence='changed'")).rejects.toThrow("append-only");
  } finally { await fixture.close(); }
});
