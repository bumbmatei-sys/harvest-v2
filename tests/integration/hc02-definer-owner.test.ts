import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";
import { eraseConnectResponse, isConnectResponsePurposeActive, listPendingResponseSummaries, purgeExpiredConnectResponses, withdrawConnectResponsePurpose } from "../../src/server/connect-responses";

// Review B2: the Connect rights definers must work when their owner obeys FORCE RLS (no superuser,
// no BYPASSRLS). The test role gets full table privileges but only copies of the row policies the
// migration installs for its own owner, so a missing migration-owner policy fails here.
const role = "harvest_test_connect_owner";
const definers = ["public.withdraw_connect_response_purpose(uuid,uuid,text)", "public.erase_connect_response(uuid,uuid)",
  "public.purge_expired_connect_responses(uuid)", "public.connect_response_purpose_active(uuid,uuid,text)"];
const tables = ["workspace_members", "audit_logs", "outbox_events", "jobs", "form_versions", "campaign_responses", "campaign_response_contact_methods", "campaign_response_consents", "connect_intake_receipts", "connect_intake_limits", "connect_intake_events", "contacts", "contact_consents", "contact_source_events", "connect_response_subjects", "connect_consent_origins", "connect_claim_completions", "connect_invitations", "connect_invitation_flows", "response_account_claims"];
let fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string, campaign: string, link: string, version: string, notice: string;
let roleCreated = false;
const copied: { table: string; name: string }[] = [];

async function seed(name: string, purposes: string[]) {
  const { rows: [response] } = await fixture.admin.query(`insert into campaign_responses (tenant_id, campaign_id, link_id, form_version_id, public_submission_id, preferred_name, locale)
    values ($1,$2,$3,$4,$5,$6,'en') returning id`, [tenant, campaign, link, version, randomUUID(), name]);
  await fixture.admin.query("insert into campaign_response_contact_methods (tenant_id, response_id, kind, value, normalized_value) values ($1,$2,'email',$3,$3)", [tenant, response.id, `${name.toLowerCase().replace(/ /g, "-")}@example.test`]);
  for (const purpose of purposes) {
    await fixture.admin.query(`insert into campaign_response_consents (tenant_id, response_id, purpose, status, channel, form_version_id, notice_version_id, actor_kind)
      values ($1,$2,$3,'granted','email',$4,$5,'subject')`, [tenant, response.id, purpose, version, notice]);
  }
  return response.id as string;
}

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-o", "member-o", "owner-p"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "owner-o", "Definer owner")).tenantId;
  other = (await createWorkspace(fixture.db, "owner-p", "Other workspace")).tenantId;
  await putMember(fixture.db, "owner-o", tenant, "member-o@example.test", "member");
  campaign = (await createCampaign(fixture.db, "owner-o", tenant, { name: "Synthetic crusade", type: "evangelistic_crusade" }, "hc02-owner")).id;
  ({ notice, version, link } = await withTenant(fixture.db, "owner-o", tenant, "workspace:read", async (tx) => {
    const [n] = (await tx.execute(sql`insert into privacy_notice_versions (tenant_id, notice_key, version, locale, body, body_sha256, created_by) values (${tenant}, 'owner', 1, 'en', 'Synthetic notice (test fixture)', ${"0".repeat(64)}, 'owner-o') returning id`)).rows as { id: string }[];
    const [f] = (await tx.execute(sql`insert into forms (tenant_id, name, created_by) values (${tenant}, 'Owner form', 'owner-o') returning id`)).rows as { id: string }[];
    const [v] = (await tx.execute(sql`insert into form_versions (tenant_id, form_id, version, offered_purposes, notice_version_id, pending_retention_days, created_by) values (${tenant}, ${f.id}, 1, '{outreach_follow_up,newsletter}', ${n.id}, 30, 'owner-o') returning id`)).rows as { id: string }[];
    await tx.execute(sql`update form_versions set status = 'published', published_by = 'owner-o' where id = ${v.id}`);
    const [l] = (await tx.execute(sql`insert into campaign_response_links (tenant_id, campaign_id, form_version_id, public_code, created_by) values (${tenant}, ${campaign}, ${v.id}, ${randomBytes(16).toString("hex")}, 'owner-o') returning id`)).rows as { id: string }[];
    return { notice: n.id, version: v.id, link: l.id };
  }));
  await fixture.admin.query("update campaign_response_links set status = 'published' where id = $1", [link]);

  await fixture.admin.query(`create role ${role} nologin nosuperuser nobypassrls noinherit`);
  roleCreated = true;
  await fixture.admin.query(`grant usage on schema public to ${role}`);
  await fixture.admin.query(`grant select, insert, update, delete on ${tables.join(", ")} to ${role}`);
  await fixture.admin.query(`grant execute on function public.connect_scrub_response(uuid,uuid) to ${role}`);
  // 0043: the owner's retention scan policy and the delete branch of the guards call the policy function; the real owner owns it.
  await fixture.admin.query(`grant execute on function public.connect_retention_policy() to ${role}`);
  // Mirror exactly the policies the migration created for its owner (the role running migrations).
  const { rows: [{ owner }] } = await fixture.admin.query("select current_user as owner");
  const { rows: policies } = await fixture.admin.query(`select tablename, policyname, cmd, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = any($1) and $2 = any(roles)`, [tables, owner]);
  expect([...new Set(policies.map((policy) => policy.tablename))].sort()).toEqual([...tables].sort());
  for (const policy of policies) {
    const name = `test_owner_${policy.policyname}`;
    await fixture.admin.query(`create policy ${name} on public.${policy.tablename} for ${policy.cmd} to ${role}`
      + (policy.qual ? ` using (${policy.qual})` : "") + (policy.with_check ? ` with check (${policy.with_check})` : ""));
    copied.push({ table: policy.tablename, name });
  }
  for (const definer of definers) await fixture.admin.query(`alter function ${definer} owner to ${role}`);
});
afterAll(async () => {
  if (roleCreated) {
    for (const definer of definers) await fixture.admin.query(`do $$ begin execute format('alter function ${definer} owner to %I', current_user); end $$`);
    for (const { table, name } of copied) await fixture.admin.query(`drop policy if exists ${name} on public.${table}`);
    await fixture.admin.query(`drop owned by ${role}`);
    await fixture.admin.query(`drop role ${role}`);
  }
  await fixture?.close();
});

it("runs withdrawal, the purpose recheck, erasure and purge with a non-bypass definer owner", async () => {
  const { rows: [owner] } = await fixture.admin.query(`select r.rolsuper, r.rolbypassrls, (select count(distinct proowner)::int from pg_proc where oid = any($1::regprocedure[])) as owners,
    (select pg_get_userbyid(proowner) from pg_proc where oid = $2::regprocedure) as name from pg_roles r where r.rolname = $3`, [definers, definers[0], role]);
  expect(owner).toEqual({ rolsuper: false, rolbypassrls: false, owners: 1, name: role });

  const response = await seed("Owner Guest", ["outreach_follow_up", "newsletter"]);
  expect(await withdrawConnectResponsePurpose(fixture.db, "owner-o", tenant, response, "newsletter")).toEqual({ outcome: "withdrawn" });
  expect((await fixture.admin.query("select count(*)::int as count from campaign_response_consents where response_id = $1 and status = 'withdrawn' and recorded_by = 'owner-o'", [response])).rows[0].count).toBe(1);
  expect(await isConnectResponsePurposeActive(fixture.db, "owner-o", tenant, response, "newsletter")).toBe(false);
  expect(await isConnectResponsePurposeActive(fixture.db, "owner-o", tenant, response, "outreach_follow_up")).toBe(true);
  // The owner's tenant-scoped policies still confine the definers to the caller's workspace.
  await expect(withdrawConnectResponsePurpose(fixture.db, "owner-p", other, response, "outreach_follow_up")).rejects.toMatchObject({ status: 404 });
  await expect(withdrawConnectResponsePurpose(fixture.db, "member-o", tenant, response, "outreach_follow_up")).rejects.toMatchObject({ status: 403 });

  expect(await eraseConnectResponse(fixture.db, "owner-o", tenant, response)).toEqual({ erased: true });
  const after = JSON.stringify((await fixture.admin.query("select * from campaign_responses where tenant_id = $1", [tenant])).rows)
    + JSON.stringify((await fixture.admin.query("select * from campaign_response_contact_methods where tenant_id = $1", [tenant])).rows)
    + JSON.stringify((await fixture.admin.query("select * from campaign_response_consents where tenant_id = $1", [tenant])).rows);
  for (const secret of [response, "Owner Guest", "owner-guest@example.test"]) expect(after).not.toContain(secret);
  expect((await fixture.admin.query("select count(*)::int as count from campaign_response_consents where tenant_id = $1 and redacted_at is not null", [tenant])).rows[0].count).toBe(3);

  const expired = await seed("Expired Owner Guest", ["outreach_follow_up"]);
  await fixture.admin.query("update campaign_responses set expires_at = now() - interval '1 second' where id = $1", [expired]);
  expect((await listPendingResponseSummaries(fixture.db, "owner-o", tenant, campaign)).find((row) => row.id === expired)?.activePurposes).toEqual([]);
  expect(await purgeExpiredConnectResponses(fixture.db, "owner-o", tenant)).toEqual({ purged: 1 });
  expect((await fixture.admin.query("select count(*)::int as count from campaign_responses where tenant_id = $1 and status = 'erased'", [tenant])).rows[0].count).toBe(2);
});
