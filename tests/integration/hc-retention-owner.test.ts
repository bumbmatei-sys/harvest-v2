import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { retentionHealth, runRetention } from "../../src/server/connect-retention";

// The retention sweep with the migration owner as an actual non-bypass role (FORCE RLS applies to it): expired intake
// responses become tombstones, old tombstones and their consent rows are deleted, and nothing else is.
it("sweeps and expires tombstones as a restricted owner", async () => {
  const f = await testDatabase({ migrationOwner: true });
  try {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
    await f.db.insert(users).values({ id: "ro-owner", name: "Owner", email: "ro-owner@example.test", emailVerified: true });
    const tenant = (await createWorkspace(f.db, "ro-owner", "Retention owner test")).tenantId;
    const campaign = (await createCampaign(f.db, "ro-owner", tenant, { name: "Campaign", type: "conference" }, randomUUID())).id;
    const version = await publishIntakeForm(f.db, "ro-owner", tenant, campaign, { name: "V3", notice: "Synthetic test", retentionDays: 1, purposes: ["account_communications", "newsletter"],
      definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
    const link = await createConnectLink(f.db, "ro-owner", tenant, campaign, { formVersionId: version.id });
    await transitionConnectLink(f.db, "ro-owner", tenant, campaign, link.id, { action: "publish" });
    const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
    await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
      purposes: ["newsletter"], email: "guest-ro@example.test" });
    const owner = async (statement: string) => {
      await f.admin.query("begin");
      try { await f.admin.query(`set local role ${f.migrationOwner}`); await f.admin.query("select set_config('app.tenant_id', $1, true)", [tenant]); await f.admin.query(statement); await f.admin.query("commit"); }
      catch (error) { await f.admin.query("rollback"); throw error; }
    };
    const pool = { query: async <R extends Record<string, unknown>>(text: string, values?: unknown[]) => f.pool.query<R>(text, values) };
    // Not expired yet: nothing happens.
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 0 });
    await owner("update campaign_responses set expires_at = now() - interval '1 hour' where status = 'pending'");
    expect(await runRetention(pool)).toMatchObject({ erased: 1, deleted: 0 });
    const { rows: tombs } = await f.admin.query("select count(*)::int n from (select 1 from campaign_responses where status = 'erased') x");
    expect(tombs[0].n).toBe(1);
    // A fresh tombstone stays; an old one goes with its redacted consent rows.
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 0 });
    await owner("update campaign_responses set erased_at = date_trunc('day', now() - interval '91 days') where status = 'erased'");
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 1 });
    await f.admin.query("begin");
    try {
      await f.admin.query(`set local role ${f.migrationOwner}`);
      await f.admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      expect((await f.admin.query("select (select count(*)::int from campaign_responses) r, (select count(*)::int from campaign_response_consents) c")).rows[0]).toEqual({ r: 0, c: 0 });
    } finally { await f.admin.query("rollback"); }
    expect(await retentionHealth(pool)).toMatchObject({ healthy: true });
  } finally { vi.unstubAllEnvs(); await f.close(); }
});
