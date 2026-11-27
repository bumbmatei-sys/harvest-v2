import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// Migration 0128 as the NOBYPASSRLS migration owner: communities and audit_logs have FORCE RLS, so the backfill must relax and restore it (the 0091
// pattern) or it reaches no rows. A community published before it, and one the audit log shows was published and then unpublished, get the marker
// (earliest publish, else the last update); a never-published draft does not; FORCE is back on both tables; and the lock holds for the backfilled rows.
const tenant = randomUUID(), published = randomUUID(), unpublished = randomUUID(), never = randomUUID();
const updated = "2026-10-01T10:00:00.000Z", firstPublish = "2026-09-15T08:30:00.000Z";
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true, beforeCommunityAddressLockMigration: async (admin) => {
    // Seeded as the cluster superuser with foreign-key triggers off: only the community and audit rows matter here; CHECKs still apply.
    await admin.query("SET session_replication_role = replica");
    for (const [id, slug, status] of [[published, "lock-mig-live", "published"], [unpublished, "lock-mig-was-live", "draft"], [never, "lock-mig-draft", "draft"]] as const) {
      await admin.query("insert into communities (tenant_id, id, slug, name, status, updated_at) values ($1, $2, $3, 'Seed', $4, $5)", [tenant, id, slug, status, updated]);
    }
    for (const [action, at] of [["community.publish", firstPublish], ["community.unpublish", "2026-09-20T08:30:00.000Z"], ["community.publish", "2026-09-18T08:30:00.000Z"]]) {
      await admin.query("insert into audit_logs (tenant_id, actor_id, action, target_id, created_at) values ($1, 'seed-user', $2, $3, $4)", [tenant, action, unpublished, at]);
    }
    await admin.query("SET session_replication_role = origin");
  } });
});
afterAll(async () => { await f?.close(); });

it("backfills the marker under FORCE row security, restores FORCE, and locks the backfilled addresses", async () => {
  const { rows } = await f.admin.query("select id, first_published_at from communities where tenant_id = $1", [tenant]);
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.first_published_at?.toISOString() ?? null]));
  expect(byId).toEqual({ [published]: updated, [unpublished]: firstPublish, [never]: null });
  const forced = await f.admin.query("select relname, relforcerowsecurity from pg_class where oid in ('public.communities'::regclass, 'public.audit_logs'::regclass) order by relname");
  expect(forced.rows).toEqual([{ relname: "audit_logs", relforcerowsecurity: true }, { relname: "communities", relforcerowsecurity: true }]);
  for (const id of [published, unpublished]) {
    await expect(f.admin.query("update communities set slug = 'lock-mig-changed' where id = $1", [id])).rejects.toMatchObject({ code: "23514", constraint: "community_address_locked" });
  }
  expect((await f.admin.query("update communities set slug = 'lock-mig-draft-two' where id = $1 returning slug", [never])).rows).toEqual([{ slug: "lock-mig-draft-two" }]);
});
