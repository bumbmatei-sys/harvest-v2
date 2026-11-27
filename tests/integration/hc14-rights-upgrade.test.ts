import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { expect, it, vi } from "vitest";
import { testDatabase, migrationCount } from "../database";
import * as schema from "../../src/db/schema";
import type { Database } from "../../src/db/client";
import { createLegacyWorkspace } from "../helpers/legacy-workspace";
import { createLegacyCampaign } from "../helpers/legacy-campaign";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { consumeInvitation, dispatchInvitation, prepareInvitation } from "../../src/server/connect-invitations";
import { applySubjectRights, listSubjectResponses } from "../../src/server/connect-subject-rights";
import { assignFollowUpCase, listFollowUpCases, openEligibleFollowUpCases, transitionFollowUpCase } from "../../src/server/follow-up-cases";
import { invitationRecipientHash, receiptHash } from "../../src/server/connect-intake-crypto";
import { withUser } from "../../src/server/tenancy";
import { recordConsent } from "../../src/server/contacts";

vi.mock("server-only", () => ({}));
function synthetic() {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", "postgresql://localhost/harvest_test");
  vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
}
// Real intake -> test-only invitation callback -> verified claim -> association, no shortcut to the consent projection.
async function seed(db: Database, legacy = false) {
  const owner = `hc14-${randomUUID()}`, guest = `guest-${randomUUID()}`, email = `${guest}@example.test`;
  await db.insert(schema.users).values([{ id: owner, name: "Synthetic owner", email: `${owner}@example.test`, emailVerified: true }, { id: guest, name: "Synthetic guest", email, emailVerified: true }]);
  const tenant = (await createLegacyWorkspace(db, owner, "Synthetic HC14")).tenantId;
  const campaign = (await createLegacyCampaign(db, owner, tenant, { name: "Synthetic campaign", type: "conference" }, randomUUID())).id;
  const form = await publishIntakeForm(db, owner, tenant, campaign, { name: "Synthetic form", notice: "Synthetic notice", retentionDays: 7,
    purposes: ["account_communications", "outreach_follow_up"], definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  const link = await createConnectLink(db, owner, tenant, campaign, { formVersionId: form.id });
  await transitionConnectLink(db, owner, tenant, campaign, link.id, { action: "publish" });
  const manifest = (await readIntakeManifest(db, "qr", link.publicCode))!;
  await submitIntake(db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability, purposes: ["account_communications", "outreach_follow_up"], email });
  let token = ""; await dispatchInvitation(db, async (mail) => { token = mail.token; });
  const flow = await prepareInvitation(db, { token });
  if (legacy) {
    // This fixture seeds migration 0050, before the audited claim capability exists.
    await withUser(db, guest, async tx => {
      await tx.execute(sql`select set_config('app.connect_intake_mode','synthetic',true)`);
      const hash = receiptHash(flow);
      const { rows: [row] } = await tx.execute<{ info: { recipientBinding: string } }>(sql`select public.connect_invitation_flow(${hash}) info`);
      const proof = invitationRecipientHash(email, row.info.recipientBinding);
      const { rows: [claim] } = await tx.execute<{ outcome: string }>(sql`
        select public.connect_invitation_consume_verified(${hash}, ${guest}, ${proof}, ${email}, null, false) outcome
      `);
      expect(claim.outcome).toBe("claimed");
    });
  } else {
    await consumeInvitation(db, flow, { id: guest, email, emailVerified: true }, { action: "confirm" });
  }
  await openEligibleFollowUpCases(db, owner, tenant);
  const c = (await listFollowUpCases(db, owner, tenant)).items[0];
  await transitionFollowUpCase(db, owner, tenant, c.id, { to: "awaiting_assignment", version: 1 });
  await assignFollowUpCase(db, owner, tenant, c.id, { assigneeId: owner, version: 2 });
  return { owner, guest, tenant, caseId: c.id, contactId: c.contactId, handle: (await listSubjectResponses(db, guest)).items[0].handle };
}

it("propagates a verified subject's response withdrawal atomically; replay is idempotent under FORCE RLS", async () => {
  synthetic(); const f = await testDatabase({ migrationOwner: true });
  try {
    const s = await seed(f.db), unaffected = await seed(f.db);
    for (let i = 0; i < 2; i++) await applySubjectRights(f.db, s.guest, { handle: s.handle, action: "withdraw", purpose: "outreach_follow_up" });
    expect((await listFollowUpCases(f.db, s.owner, s.tenant)).items[0]).toMatchObject({ state: "withdrawn", assigneeId: null, version: 4 });
    const rows = (await f.admin.query("select actor_id,metadata from audit_logs where tenant_id=$1 and action='followup.case.withdraw'", [s.tenant])).rows;
    expect(rows).toEqual([{ actor_id: null, metadata: { from: "assigned", to: "withdrawn", previousAssignee: s.owner } }]);
    expect(JSON.stringify(rows)).not.toContain(s.contactId);
    expect((await listFollowUpCases(f.db, unaffected.owner, unaffected.tenant)).items[0]).toMatchObject({ state: "assigned", version: 3 });
  } finally { await f.close(); vi.unstubAllEnvs(); }
});

it("upgrades populated 0050 with a restricted owner, reconciles withdrawn cases once and preserves the read policy", async () => {
  synthetic(); let old: Awaited<ReturnType<typeof seed>>; let readPolicy: unknown;
  const f = await testDatabase({ migrationOwner: true, beforeHc14Migration: async (admin) => {
    expect((await admin.query("select max(created_at)::text as last from drizzle.__drizzle_migrations")).rows[0].last).toBe("1795200000000");
    old = await seed(drizzle(admin, { schema }), true);
    await recordConsent(drizzle(admin, { schema }), old.owner, old.tenant, old.contactId, { purpose: "outreach_follow_up", channel: "sms", status: "withdrawn", noticeVersion: "notice-v1", source: "Synthetic", evidence: "Synthetic" });
    expect((await admin.query("select state from followup_cases where id=$1", [old.caseId])).rows[0].state).toBe("assigned");
    readPolicy = (await admin.query("select qual,roles,cmd from pg_policies where tablename='followup_cases' and policyname='followup_cases_read'")).rows;
  } });
  try {
    expect((await f.admin.query("select count(*)::int as n from drizzle.__drizzle_migrations")).rows[0].n).toBe(migrationCount);
    expect((await f.admin.query("select state,assignee_id,version from followup_cases where id=$1", [old!.caseId])).rows).toEqual([{ state: "withdrawn", assignee_id: null, version: 4 }]);
    expect((await f.admin.query("select actor_id,metadata from audit_logs where action='followup.case.withdraw' and target_id=$1", [old!.caseId])).rows).toEqual([{ actor_id: null, metadata: { from: "assigned", to: "withdrawn", previousAssignee: old!.owner } }]);
    // Migration 0113 wraps the role in public.access_role (per-feature access); the policy is otherwise unchanged.
    const unwrap = (rows: { qual: string }[]) => rows.map((row) => ({ ...row, qual: row.qual.replace(/(?:public\.)?access_role\((\w+)\.tenant_id, \1\.user_id, 'connect'::text, (\w+\.role_id)\)/g, "$2") }));
    expect(unwrap((await f.admin.query("select qual,roles,cmd from pg_policies where tablename='followup_cases' and policyname='followup_cases_read'")).rows)).toEqual(unwrap(readPolicy as { qual: string }[]));
    expect((await f.admin.query("select policyname from pg_policies where policyname='hc14_backfill_scan'")).rows).toEqual([]);
  } finally { await f.close(); vi.unstubAllEnvs(); }
});
