import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { createConnectLink, transitionConnectLink } from "../../src/server/connect-links";
import { publishIntakeForm, readIntakeManifest, submitIntake } from "../../src/server/connect-intake";
import { listPendingResponseSummaries } from "../../src/server/connect-responses";

// The audited read when the migration owner is a real non-superuser, non-BYPASSRLS role (FORCE RLS applies to the definer owner),
// on a response that arrived through the real synthetic intake path.
it("reads and audits pending metadata as a restricted owner", async () => {
  const f = await testDatabase({ migrationOwner: true });
  try {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("DATABASE_URL", f.appURL); vi.stubEnv("HARVEST_CONNECT_INTAKE", "synthetic"); vi.stubEnv("HARVEST_CONNECT_TEST_KEY", "a".repeat(64));
    await f.db.insert(users).values(["do-owner", "do-admin", "do-member"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
    const tenant = (await createWorkspace(f.db, "do-owner", "Dec2 owner test")).tenantId;
    await putMember(f.db, "do-owner", tenant, "do-admin@example.test", "admin");
    await putMember(f.db, "do-owner", tenant, "do-member@example.test", "member");
    const campaign = (await createCampaign(f.db, "do-owner", tenant, { name: "Campaign", type: "conference" }, randomUUID())).id;
    const version = await publishIntakeForm(f.db, "do-owner", tenant, campaign, { name: "V3", notice: "Synthetic test", retentionDays: 7, purposes: ["account_communications", "newsletter"],
      definition: { kind: "connect-intake-v3", syntheticOnly: true, preferredName: false, followUpChannel: "email" } });
    const link = await createConnectLink(f.db, "do-owner", tenant, campaign, { formVersionId: version.id });
    await transitionConnectLink(f.db, "do-owner", tenant, campaign, link.id, { action: "publish" });
    const manifest = (await readIntakeManifest(f.db, "qr", link.publicCode))!;
    await submitIntake(f.db, "qr", link.publicCode, { submissionId: randomUUID(), receiptToken: manifest.receiptToken, stamp: manifest.stamp, capability: manifest.capability,
      purposes: ["account_communications", "newsletter"], email: "guest-dec2@example.test" });

    const rows = await listPendingResponseSummaries(f.db, "do-admin", tenant, campaign);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "pending", linkId: link.id, formVersionId: version.id, activePurposes: ["account_communications", "newsletter"] });
    expect(rows[0].noticeVersionId).toBeTruthy();
    const audit = async () => (await f.admin.query("select actor_id, target_id, metadata from audit_logs where tenant_id = $1 and action = 'connect.pending.read'", [tenant])).rows;
    expect(await audit()).toEqual([{ actor_id: "do-admin", target_id: campaign, metadata: { count: "1" } }]);
    expect(JSON.stringify(await audit())).not.toContain("guest-dec2@example.test");
    await expect(listPendingResponseSummaries(f.db, "do-member", tenant, campaign)).rejects.toMatchObject({ status: 403 });
    expect(await audit()).toHaveLength(1);
  } finally { await f.close(); }
});
