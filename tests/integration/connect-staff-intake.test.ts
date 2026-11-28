import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { applyIntakeRights, publishIntakeForm, readIntakeManifest, submitAssistedIntake } from "../../src/server/connect-intake";

let db: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string, campaign: string, code: string, noticeVersion: string;
const owner = "assisted-owner", member = "assisted-member";
beforeAll(async () => {
  db = await testDatabase({ migrationOwner: true });
  vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic");
  vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "d".repeat(64));
  vi.stubEnv("DATABASE_URL", db.appURL);
  await db.db.insert(users).values([owner, member].map(id => ({ id, name: id, email: `${id}@example.invalid` })));
  tenant = (await createWorkspace(db.db, owner, "Synthetic ministry")).tenantId;
  await putMember(db.db, owner, tenant, `${member}@example.invalid`, "member");
  campaign = (await createCampaign(db.db, owner, tenant, { name: "Synthetic event", type: "conference" }, "assisted-event")).id;
  const version = await publishIntakeForm(db.db, owner, tenant, campaign, { name: "Test form", notice: "Synthetic consent wording",
    retentionDays: 3, purposes: ["newsletter", "outreach_follow_up"],
    definition: { kind: "connect-intake-v1", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
  noticeVersion = (await db.admin.query("select notice_version_id from form_versions where id=$1", [version.id])).rows[0].notice_version_id;
  const link = await createConnectLink(db.db, owner, tenant, campaign, { label: "Test QR", formVersionId: version.id });
  await transitionConnectLink(db.db, owner, tenant, campaign, link.id, { action: "publish" });
  code = link.publicCode;
});
afterAll(async () => { vi.unstubAllEnvs(); await db?.close(); });

async function payload(method: "phone" | "in_person") {
  const manifest = (await readIntakeManifest(db.db, "qr", code))!;
  const { stamp, capability, receiptToken } = manifest;
  return { intake: { submissionId: randomUUID(), stamp, capability, receiptToken, email: "participant@example.invalid",
    purposes: ["outreach_follow_up"] }, evidence: { method, wordingVersion: stamp } };
}

it("denies staff without Connect access and rejects a different campaign or wording version", async () => {
  const input = await payload("in_person");
  const submit = (actor: string, campaignId: string, value: unknown) => submitAssistedIntake(db.db, actor, tenant, campaignId, "qr", code, value);
  await expect(submit(member, campaign, input)).rejects.toMatchObject({ status: 403 });
  await expect(submit(owner, randomUUID(), input)).rejects.toMatchObject({ status: 404 });
  await expect(submit(owner, campaign, { ...input, evidence: { ...input.evidence, wordingVersion: "a".repeat(64) } })).rejects.toMatchObject({ status: 409 });
  expect((await db.admin.query("select 1 from campaign_responses where public_submission_id=$1", [input.intake.submissionId])).rowCount).toBe(0);
});

it.each(["in_person", "phone"] as const)("records %s evidence and honors the ordinary withdrawal and erasure receipt", async method => {
  const input = await payload(method);
  const submit = () => submitAssistedIntake(db.db, owner, tenant, campaign, "qr", code, input);
  await expect(submit()).resolves.toMatchObject({ pending: true, replayed: false });
  await expect(submit()).resolves.toMatchObject({ pending: true, replayed: true });
  const { rows: [row] } = await db.admin.query(`select r.id, c.purpose, c.notice_version_id, c.actor_kind, c.assisted_evidence, c.recorded_at
    from campaign_responses r join campaign_response_consents c on c.tenant_id = r.tenant_id and c.response_id = r.id
    where r.public_submission_id = $1`, [input.intake.submissionId]);
  expect(row).toMatchObject({ purpose: "outreach_follow_up", notice_version_id: noticeVersion, actor_kind: "subject",
    assisted_evidence: { ...input.evidence, recordedBy: owner }, recorded_at: expect.any(Date) });
  const { receiptToken } = input.intake;
  await applyIntakeRights(db.db, { receiptToken, action: "withdraw", purpose: "outreach_follow_up" });
  expect((await db.admin.query("select status from campaign_response_consents where response_id=$1 order by status", [row.id])).rows)
    .toEqual([{ status: "granted" }, { status: "withdrawn" }]);
  await applyIntakeRights(db.db, { receiptToken, action: "erase" });
  expect((await db.admin.query("select 1 from connect_intake_receipts where response_id=$1", [row.id])).rowCount).toBe(0);
  expect((await db.admin.query("select 1 from campaign_response_consents where assisted_evidence->>'wordingVersion'=$1", [input.evidence.wordingVersion])).rowCount).toBe(0);
});
