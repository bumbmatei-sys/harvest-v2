import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";

// Shared seed for the HC-DEC2 tests: two ministries, every role in A, one synthetic pending response with a name,
// a contact method and two grants, seeded through the admin pool (HC-05's intake definer is not under test here).
export const SECRETS = { name: "Synthetic Seeker Name", email: "seeker-dec2@example.test" };
export async function dec2Fixture(options: { migrationOwner?: boolean } = {}) {
  const f = await testDatabase(options);
  await f.db.insert(users).values(["d-owner", "d-admin", "d-member", "d-viewer", "d-other"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  const tenantA = (await createWorkspace(f.db, "d-owner", "Pending access A")).tenantId;
  const tenantB = (await createWorkspace(f.db, "d-other", "Pending access B")).tenantId;
  for (const [user, role] of [["d-admin", "admin"], ["d-member", "member"], ["d-viewer", "viewer"]] as const) await putMember(f.db, "d-owner", tenantA, `${user}@example.test`, role);
  const campaign = (await createCampaign(f.db, "d-owner", tenantA, { name: "Synthetic crusade", type: "evangelistic_crusade" }, "dec2-a")).id;
  const emptyCampaign = (await createCampaign(f.db, "d-owner", tenantA, { name: "Empty crusade", type: "evangelistic_crusade" }, "dec2-empty")).id;
  const { notice, version, link } = await withTenant(f.db, "d-owner", tenantA, "workspace:read", async (tx) => {
    const [n] = (await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by) values (${tenantA}, 'dec2', 1, 'en', 'Synthetic notice (test fixture)', ${"0".repeat(64)}, 'd-owner') returning id`)).rows as { id: string }[];
    const [form] = (await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenantA}, 'Dec2 form', 'd-owner') returning id`)).rows as { id: string }[];
    const [v] = (await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, created_by) values (${tenantA}, ${form.id}, 1, '{outreach_follow_up,newsletter}', ${n.id}, 30, 'd-owner') returning id`)).rows as { id: string }[];
    await tx.execute(sql`update form_versions set status = 'published', published_by = 'd-owner' where id = ${v.id}`);
    const [l] = (await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, created_by) values (${tenantA}, ${campaign}, ${v.id}, ${randomBytes(16).toString("hex")}, 'd-owner') returning id`)).rows as { id: string }[];
    return { notice: n.id, version: v.id, link: l.id };
  });
  await f.admin.query("update campaign_response_links set status = 'published' where id = $1", [link]);
  async function seedResponse(purposes = ["outreach_follow_up", "newsletter"]) {
    const { rows: [response] } = await f.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, preferred_name, locale)
      values ($1,$2,$3,$4,$5,$6,'en') returning id`, [tenantA, campaign, link, version, randomUUID(), SECRETS.name]);
    await f.admin.query("insert into campaign_response_contact_methods (tenant_id, response_id, kind, value, normalized_value) values ($1,$2,'email',$3,$3)", [tenantA, response.id, SECRETS.email]);
    for (const purpose of purposes) await f.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind)
      values ($1,$2,$3,'granted','email',$4,$5,'subject')`, [tenantA, response.id, purpose, version, notice]);
    return response.id as string;
  }
  const audit = async (action = "connect.pending.read") => (await f.admin.query("select actor_id, target_id, metadata, action from audit_logs where tenant_id = $1 and action = $2 order by created_at, id", [tenantA, action])).rows;
  return { f, tenantA, tenantB, campaign, emptyCampaign, link, version, notice, seedResponse, audit };
}
