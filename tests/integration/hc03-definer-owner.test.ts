import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { createWorkspace, putMember } from "../../src/server/workspaces";
import { createCampaign } from "../../src/server/campaigns";
import { withTenant } from "../../src/server/tenancy";
import { createConnectLink, resolveConnectLink, transitionConnectLink } from "../../src/server/connect-links";

// The HC-03 definers (lifecycle, code registration, public resolver) must work when their owner
// obeys FORCE RLS without superuser or BYPASSRLS. The test role gets table privileges but only
// copies of the row policies the migration installs for its own owner, so a missing or too-wide
// owner policy shows up here.
const role = "harvest_test_connect_link_owner";
const definers = ["public.connect_link_transition(uuid,uuid,text,timestamptz,text)", "public.connect_register_link_codes()", "public.resolve_connect_link(text,text)"];
const tables = ["workspace_members", "audit_logs", "campaigns", "form_versions", "campaign_response_links", "campaign_response_link_codes"];
let fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string, other: string, campaign: string, otherCampaign: string;
let roleCreated = false;
const copied: { table: string; name: string }[] = [];

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["owner-o", "member-o", "owner-p"].map((id) => ({ id, name: id, email: `${id}@example.test` })));
  tenant = (await createWorkspace(fixture.db, "owner-o", "Definer owner")).tenantId;
  other = (await createWorkspace(fixture.db, "owner-p", "Other workspace")).tenantId;
  await putMember(fixture.db, "owner-o", tenant, "member-o@example.test", "member");
  campaign = (await createCampaign(fixture.db, "owner-o", tenant, { name: "Synthetic crusade", type: "evangelistic_crusade" }, "hc03-owner")).id;
  otherCampaign = (await createCampaign(fixture.db, "owner-p", other, { name: "Other crusade", type: "conference" }, "hc03-other")).id;

  await fixture.admin.query(`create role ${role} nologin nosuperuser nobypassrls noinherit`);
  roleCreated = true;
  await fixture.admin.query(`grant usage on schema public to ${role}`);
  await fixture.admin.query(`grant select, insert, update, delete on ${tables.join(", ")} to ${role}`);
  await fixture.admin.query(`grant execute on function public.connect_random_hex(integer), public.connect_short_code() to ${role}`);
  const { rows: [{ owner }] } = await fixture.admin.query("select current_user as owner");
  const { rows: policies } = await fixture.admin.query(`select tablename, policyname, cmd, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = any($1) and $2 = any(roles)`, [tables, owner]);
  // The migration owner has policies on every table its definers touch, and none of them is unconditional.
  expect([...new Set(policies.map((policy) => policy.tablename))].sort()).toEqual([...tables].sort());
  // INSERT-only policies (e.g. the PR 3 community audit policy) have a WITH CHECK but no USING clause.
  for (const policy of policies) expect(policy.qual ?? policy.with_check, `${policy.tablename}.${policy.policyname}`).toMatch(/current_setting/);
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

it("creates, publishes, rotates, resolves and archives with a non-bypass definer owner", async () => {
  const { rows: [owner] } = await fixture.admin.query(`select r.rolsuper, r.rolbypassrls, (select count(distinct proowner)::int from pg_proc where oid = any($1::regprocedure[])) as owners,
    (select pg_get_userbyid(proowner) from pg_proc where oid = $2::regprocedure) as name from pg_roles r where r.rolname = $3`, [definers, definers[0], role]);
  expect(owner).toEqual({ rolsuper: false, rolbypassrls: false, owners: 1, name: role });
  const link = await createConnectLink(fixture.db, "member-o", tenant, campaign, { publicTitle: "Owner test" });
  expect((await fixture.admin.query("select count(*)::int as count from campaign_response_link_codes where link_id = $1", [link.id])).rows[0].count).toBe(2);
  expect((await transitionConnectLink(fixture.db, "owner-o", tenant, campaign, link.id, { action: "publish" })).outcome).toBe("published");
  expect(await resolveConnectLink(fixture.db, "qr", link.publicCode)).toEqual({ locale: "en", title: "Owner test" });
  expect(await resolveConnectLink(fixture.db, "short", link.shortCode)).toEqual({ locale: "en", title: "Owner test" });
  const rotated = await transitionConnectLink(fixture.db, "owner-o", tenant, campaign, link.id, { action: "rotate", expectedCode: link.publicCode });
  expect(rotated.outcome).toBe("rotated");
  expect(await resolveConnectLink(fixture.db, "qr", link.publicCode)).toBeUndefined();
  expect(await resolveConnectLink(fixture.db, "qr", rotated.link.publicCode)).toBeDefined();
  // Another workspace's link resolves from its own code, and is out of reach of this workspace's owner.
  const foreign = await createConnectLink(fixture.db, "owner-p", other, otherCampaign, {});
  await transitionConnectLink(fixture.db, "owner-p", other, otherCampaign, foreign.id, { action: "publish" });
  expect(await resolveConnectLink(fixture.db, "qr", foreign.publicCode)).toEqual({ locale: "en", title: null });
  await expect(withTenant(fixture.db, "owner-o", tenant, "workspace:read", (tx) => tx.execute(sql`select public.connect_link_transition(${tenant}::uuid, ${foreign.id}::uuid, 'archive', null, null) as outcome`)))
    .resolves.toMatchObject({ rows: [{ outcome: "not_found" }] });
  await expect(transitionConnectLink(fixture.db, "member-o", tenant, campaign, link.id, { action: "archive" })).rejects.toMatchObject({ status: 403 });
  expect((await transitionConnectLink(fixture.db, "owner-o", tenant, campaign, link.id, { action: "archive" })).outcome).toBe("archived");
  expect(await resolveConnectLink(fixture.db, "qr", rotated.link.publicCode)).toBeUndefined();
  expect((await fixture.admin.query("select status from campaign_response_links where id = $1", [foreign.id])).rows[0].status).toBe("published");
});
