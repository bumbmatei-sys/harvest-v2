import { expect, it } from "vitest";
import { testDatabase } from "../database";

it("upgrades a database at main+#3 to 0004_files while preserving OTP issuance state", async () => {
  const fixture = await testDatabase({ async beforeFilesMigration(admin) {
    expect((await admin.query("select to_regclass('public.files') as files")).rows[0].files).toBeNull();
    expect((await admin.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows[0].count).toBe(4);
    await admin.query("insert into otp_cooldowns (email, sent_at, issued_at, reservation_id) values ('upgrade-fixture', '2026-11-04T10:00:00Z', ARRAY['2026-11-04T10:00:00Z'::timestamptz], '11111111-1111-4111-8111-111111111111')");
  } });
  try {
    expect((await fixture.admin.query("select count(*)::int as count from drizzle.__drizzle_migrations")).rows[0].count).toBe(5);
    const { rows: [otp] } = await fixture.admin.query("select cardinality(issued_at) as count, reservation_id from otp_cooldowns where email = 'upgrade-fixture'");
    expect(otp).toEqual({ count: 1, reservation_id: "11111111-1111-4111-8111-111111111111" });
    const { rows: [table] } = await fixture.admin.query("select relrowsecurity, relforcerowsecurity from pg_class where oid = 'files'::regclass");
    expect(table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    expect((await fixture.admin.query("select policyname from pg_policies where tablename = 'files' order by policyname")).rows.map((row) => row.policyname)).toEqual(["files_public_delivery", "files_tenant"]);
    expect((await fixture.db.execute("select * from files")).rows).toEqual([]);
  } finally { await fixture.close(); }
});
