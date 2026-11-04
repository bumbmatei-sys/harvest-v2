import { expect, it } from "vitest";
import { testDatabase } from "../database";
import { createContact, recordConsent } from "../../src/server/contacts";
import { createWorkspace } from "../../src/server/workspaces";

it("adds contacts and controlled consent after main's files migration without changing existing files or OTP state", async () => {
  const tenant = "11111111-1111-4111-8111-111111111111";
  const file = "22222222-2222-4222-8222-222222222222";
  const fixture = await testDatabase({ beforeShellMigration: async (admin) => {
    expect((await admin.query("select to_regclass('public.contacts') as contacts")).rows[0].contacts).toBeNull();
    expect((await admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(5);
    await admin.query("insert into users (id,name,email) values ('shell-upgrade','Upgrade','upgrade@example.test')");
    await admin.query("insert into workspaces (tenant_id,name,created_by) values ($1,'Existing workspace','shell-upgrade')", [tenant]);
    await admin.query("insert into workspace_members (tenant_id,user_id,role_id) values ($1,'shell-upgrade','owner')", [tenant]);
    await admin.query("insert into files (id,tenant_id,owner_id,key,name,mime,size,checksum,status) values ($1,$2,'shell-upgrade',$3,'existing.txt','text/plain',5,$4,'ready')", [file, tenant, `workspaces/${tenant}/files/${file}`, "a".repeat(64)]);
    await admin.query("insert into otp_cooldowns (email,sent_at,issued_at,reservation_id) values ('shell-upgrade','2026-11-04T10:00:00Z',ARRAY['2026-11-04T10:00:00Z'::timestamptz],$1)", [file]);
  } });
  try {
    expect((await fixture.admin.query("select name,status from files where id=$1", [file])).rows).toEqual([{ name: "existing.txt", status: "ready" }]);
    expect((await fixture.admin.query("select reservation_id,cardinality(issued_at) as count from otp_cooldowns where email='shell-upgrade'")).rows).toEqual([{ reservation_id: file, count: 1 }]);
    expect((await fixture.admin.query("select brand_theme from workspaces where tenant_id=$1", [tenant])).rows[0].brand_theme).toBe("harvest");
    // Exercise the generated schema plus custom policies through the restricted app role.
    const workspace = await createWorkspace(fixture.db, "shell-upgrade", "New shell workspace");
    const contact = await createContact(fixture.db, "shell-upgrade", workspace.tenantId, { name: "Synthetic consent" });
    const consent = await recordConsent(fixture.db, "shell-upgrade", workspace.tenantId, contact.id, { channel: "email", status: "granted", purpose: "marketing", noticeVersion: "notice-v1", source: "Test", evidence: "Test" });
    expect(consent.recordedBy).toBe("shell-upgrade");
    await expect(fixture.admin.query("update contact_consents set evidence='changed'")).rejects.toThrow("append-only");
    expect((await fixture.admin.query("select policyname from pg_policies where policyname='migration_backfill'")).rows).toEqual([]);
  } finally { await fixture.close(); }
});
