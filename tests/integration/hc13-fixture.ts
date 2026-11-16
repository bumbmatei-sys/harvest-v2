import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { users } from "../../src/db/schema";
import { testDatabase } from "../database";
import { createWorkspace } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { createContact, recordConsent } from "../../src/server/contacts";
import { putMember } from "../../src/server/workspaces";
import { openEligibleFollowUpCases } from "../../src/server/follow-up-cases";
import { dec2Fixture } from "./hc-dec2-fixture";

// Shared seed for the HC-13 tests: the HC-DEC2 ministries (A with owner, admin, member and viewer; B with its own owner) plus a second counselor
// and a second admin, and synthetic associated responses. Associations are seeded through the admin pool with the response guard briefly
// disabled (the verified-claim path itself is HC-06's and is not under test here); everything after seeding runs through the real code.
export const H13 = { name: "Synthetic Follower", email: "follower-hc13@example.test" };

/** The same ministries and responses as dec2Fixture, built through the real intake path (the shortcut seed cannot run under a restricted owner). */
async function restrictedBase() {
  const f = await testDatabase({ migrationOwner: true });
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
  await f.db.insert(users).values(["d-owner", "d-admin", "d-member", "d-viewer", "d-other"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  const tenantA = (await createWorkspace(f.db, "d-owner", "HC-13 A")).tenantId, tenantB = (await createWorkspace(f.db, "d-other", "HC-13 B")).tenantId;
  for (const [user, role] of [["d-admin", "admin"], ["d-member", "member"], ["d-viewer", "viewer"]] as const) await putMember(f.db, "d-owner", tenantA, `${user}@example.test`, role);
  const campaign = (await createCampaign(f.db, "d-owner", tenantA, { name: "Synthetic crusade", type: "conference" }, randomUUID())).id;
  const emptyCampaign = (await createCampaign(f.db, "d-owner", tenantA, { name: "Empty crusade", type: "conference" }, randomUUID())).id;
  const form = await publishIntakeForm(f.db, "d-owner", tenantA, campaign, { name: "V3", notice: "Synthetic test", retentionDays: 7, purposes: ["account_communications", "outreach_follow_up", "newsletter"],
    definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  const link = await createConnectLink(f.db, "d-owner", tenantA, campaign, { formVersionId: form.id });
  await transitionConnectLink(f.db, "d-owner", tenantA, campaign, link.id, { action: "publish" });
  const noticeVersion = (await f.admin.query("select notice_version_id as n from form_versions where id = $1", [form.id])).rows[0].n as string;
  async function seedResponse(purposes = ["outreach_follow_up"]) {
    const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
    await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
      purposes, email: `owner-mode-${randomUUID().slice(0, 8)}@example.test` } as never);
    return (await f.admin.query("select id from campaign_responses where link_id = $1 order by submitted_at desc, id limit 1", [link.id])).rows[0].id as string;
  }
  const audit = async (action = "connect.pending.read") => (await f.admin.query("select actor_id, target_id, metadata, action from audit_logs where tenant_id = $1 and action = $2 order by created_at, id", [tenantA, action])).rows;
  return { f, tenantA, tenantB, campaign, emptyCampaign, link: link.id as string, version: form.id as string, notice: noticeVersion, seedResponse, audit };
}

export async function hc13Fixture(options: { migrationOwner?: boolean } = {}) {
  const base = options.migrationOwner ? await restrictedBase() : await dec2Fixture(options), { f, tenantA, tenantB } = base;
  await f.db.insert(users).values(["d-member2", "d-admin2", "d-stranger"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  await putMember(f.db, "d-owner", tenantA, "d-member2@example.test", "member");
  await putMember(f.db, "d-owner", tenantA, "d-admin2@example.test", "admin");
  let counter = 0;
  /** An associated response with a live CRM contact. ledger: "granted" (default), "withdrawn" (CRM withdrawal after the grant) or "none". */
  async function seedAssociated(opts: { purposes?: string[]; ledger?: "granted" | "withdrawn" | "none"; withdrawResponse?: boolean } = {}) {
    counter += 1;
    const email = `h13-person-${counter}-${randomUUID().slice(0, 8)}@example.test`;
    const response = await base.seedResponse(opts.purposes ?? ["outreach_follow_up"]);
    const contact = await createContact(f.db, "d-owner", tenantA, { name: `${H13.name} ${counter}`, email });
    await f.admin.query("alter table campaign_responses disable trigger campaign_response_guard");
    try { await f.admin.query("update campaign_responses set status = 'associated', contact_id = $2, associated_at = now() where id = $1", [response, contact.id]); }
    finally { await f.admin.query("alter table campaign_responses enable trigger campaign_response_guard"); }
    const ledger = opts.ledger ?? "granted";
    if (ledger !== "none") {
      await recordConsent(f.db, "d-owner", tenantA, contact.id, { channel: "email", status: "granted", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Connect", evidence: "Explicit response choice", occurredAt: new Date(Date.now() - 60_000).toISOString() });
      if (ledger === "withdrawn") await recordConsent(f.db, "d-owner", tenantA, contact.id, { channel: "email", status: "withdrawn", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Staff", evidence: "Withdrawn on request" });
    }
    if (opts.withdrawResponse) {
      // The evidence guard wants the staff provenance of the transaction that records a withdrawal.
      await f.admin.query("begin");
      try {
        await f.admin.query("select set_config('app.user_id', 'd-owner', true)");
        await f.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, form_version_id, notice_version_id, actor_kind, recorded_by)
          values ($1,$2,'outreach_follow_up','withdrawn',$3,$4,'staff','d-owner')`, [tenantA, response, base.version, base.notice]);
        await f.admin.query("commit");
      } catch (error) { await f.admin.query("rollback"); throw error; }
    }
    return { response, contactId: contact.id as string, email };
  }
  /** A staff-recorded CRM withdrawal of follow-up (email), newer than the response's grant. */
  const withdrawCrm = (contactId: string) => recordConsent(f.db, "d-owner", tenantA, contactId, { channel: "email", status: "withdrawn", purpose: "outreach_follow_up", noticeVersion: "notice-v1", source: "Staff", evidence: "Withdrawn on request" });
  const caseOf = async (response: string) => (await f.admin.query("select id from followup_cases where response_id = $1", [response])).rows[0]?.id as string | undefined;
  /** Seeds one associated response and opens its case through the real service. */
  async function seedCase(opts: Parameters<typeof seedAssociated>[0] = {}) {
    const seeded = await seedAssociated(opts);
    await openEligibleFollowUpCases(f.db, "d-owner", tenantA, { limit: 200 });
    const id = await caseOf(seeded.response);
    if (!id) throw new Error("case was not opened");
    return { ...seeded, caseId: id };
  }
  const caseRow = async (id: string) => (await f.admin.query("select state, assignee_id, version, contact_id, response_id from followup_cases where id = $1", [id])).rows[0] as { state: string; assignee_id: string | null; version: number; contact_id: string; response_id: string } | undefined;
  const audit = async (like = "followup.case.%") => (await f.admin.query("select actor_id, action, target_id, metadata from audit_logs where tenant_id = $1 and action like $2 order by created_at, id", [tenantA, like])).rows as { actor_id: string; action: string; target_id: string; metadata: Record<string, string> }[];
  return { ...base, seedAssociated, seedCase, withdrawCrm, caseOf, caseRow, audit, tenantB, tenantA };
}
