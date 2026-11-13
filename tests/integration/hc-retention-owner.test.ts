import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { consumeInvitation, dispatchInvitation, prepareInvitation } from "../../src/server/connect-invitations";
import { retentionHealth, runRetention } from "../../src/server/connect-retention";

// The retention sweep with the migration owner as an actual non-bypass role (FORCE RLS applies to it): expired intake
// responses become tombstones, old tombstones and their consent rows are deleted, and nothing else is.
it("sweeps and expires tombstones as a restricted owner", async () => {
  const f = await testDatabase({ migrationOwner: true });
  try {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
    await f.db.insert(users).values([{ id: "ro-owner", name: "Owner", email: "ro-owner@example.test", emailVerified: true },
      { id: "ro-guest", name: "Guest", email: "guest-ro@example.test", emailVerified: true }]);
    const tenant = (await createWorkspace(f.db, "ro-owner", "Retention owner test")).tenantId;
    const campaign = (await createCampaign(f.db, "ro-owner", tenant, { name: "Campaign", type: "conference" }, randomUUID())).id;
    const version = await publishIntakeForm(f.db, "ro-owner", tenant, campaign, { name: "V3", notice: "Synthetic test", retentionDays: 1, purposes: ["account_communications", "newsletter"],
      definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
    const link = await createConnectLink(f.db, "ro-owner", tenant, campaign, { formVersionId: version.id });
    await transitionConnectLink(f.db, "ro-owner", tenant, campaign, link.id, { action: "publish" });
    const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
    await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
      purposes: ["account_communications", "newsletter"], email: "guest-ro@example.test" });
    // The full verified path: invitation, claim and CRM association, so every table that points at a response has rows.
    let token = ""; await dispatchInvitation(f.db, async (mail) => { token = mail.token; });
    const flow = await prepareInvitation(f.db, { token });
    await consumeInvitation(f.db, flow, { id: "ro-guest", email: "guest-ro@example.test", emailVerified: true }, { action: "confirm" });
    const owner = async (statement: string) => {
      await f.admin.query("begin");
      try { await f.admin.query(`set local role ${f.migrationOwner}`); await f.admin.query("select set_config('app.tenant_id', $1, true)", [tenant]); await f.admin.query(statement); await f.admin.query("commit"); }
      catch (error) { await f.admin.query("rollback"); throw error; }
    };
    const pool = { query: async <R extends Record<string, unknown>>(text: string, values?: unknown[]) => f.workerPool.query<R>(text, values) };
    // Not expired yet: nothing happens.
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 0 });
    const children = async () => {
      await f.admin.query("begin");
      try {
        await f.admin.query(`set local role ${f.migrationOwner}`);
        await f.admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
        return (await f.admin.query(`select (select count(*)::int from campaign_responses) responses, (select count(*)::int from campaign_response_consents) consents,
          (select count(*)::int from campaign_response_contact_methods) methods, (select count(*)::int from connect_intake_receipts) receipts,
          (select count(*)::int from connect_intake_events where response_id is not null) events, (select count(*)::int from connect_invitations) invitations,
          (select count(*)::int from response_account_claims) claims, (select count(*)::int from connect_response_subjects) subjects,
          (select count(*)::int from connect_consent_origins) origins, (select count(*)::int from connect_claim_completions) completions,
          (select count(*)::int from contact_source_events where response_id is not null) sources,
          (select status from campaign_responses limit 1) status`)).rows[0];
      } finally { await f.admin.query("rollback"); }
    };
    const before = await children();
    expect(before.status).toBe("associated");
    expect(before.sources + before.subjects + before.origins).toBeGreaterThan(0);
    await owner("update campaign_responses set expires_at = now() - interval '1 hour' where status in ('pending', 'associated')");
    expect(await runRetention(pool)).toMatchObject({ erased: 1, deleted: 0 });
    const { rows: tombs } = await f.admin.query("select count(*)::int n from (select 1 from campaign_responses where status = 'erased') x");
    expect(tombs[0].n).toBe(1);
    // A fresh tombstone stays; an old one goes with its redacted consent rows.
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 0 });
    await owner("update campaign_responses set erased_at = date_trunc('day', now() - interval '91 days') where status = 'erased'");
    expect(await runRetention(pool)).toMatchObject({ erased: 0, deleted: 1 });
    // Nothing that pointed at the response is left anywhere.
    expect(await children()).toEqual({ responses: 0, consents: 0, methods: 0, receipts: 0, events: 0, invitations: 0, claims: 0, subjects: 0, origins: 0, completions: 0, sources: 0, status: null });
    expect(await retentionHealth(pool)).toMatchObject({ healthy: true });
  } finally { vi.unstubAllEnvs(); await f.close(); }
});
