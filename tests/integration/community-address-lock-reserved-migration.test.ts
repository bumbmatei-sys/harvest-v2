import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { testDatabase } from "../database";

// Migration 0128 reserves 'unsubscribe' in the database. It cannot rename a live address, so a community already holding it must stop the
// migration loudly, with a message naming the address, not pass silently. Runs as the NOBYPASSRLS migration owner, under FORCE row security.
it("fails the migration with a clear message when a community already uses the address 'unsubscribe'", async () => {
  const fixture = testDatabase({ migrationOwner: true, beforeCommunityAddressLockMigration: async (admin) => {
    await admin.query("SET session_replication_role = replica");
    await admin.query("insert into communities (tenant_id, slug, name, status) values ($1, 'unsubscribe', 'Seed', 'published')", [randomUUID()]);
    await admin.query("SET session_replication_role = origin");
  } });
  await expect(fixture).rejects.toThrow(/reserved address "unsubscribe"/);
});
