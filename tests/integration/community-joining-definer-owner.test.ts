import { afterAll, beforeAll, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { emailHash, emailHint, hashSecret, newInviteToken } from "../../src/lib/community-listing";

// The PR 3 definers must work when their owner obeys FORCE RLS without superuser or BYPASSRLS. The test role gets
// table privileges but only copies of the row policies the migration installs for its own owner, so a missing or
// too-wide owner policy shows up here (HC-03 pattern).
const role = "harvest_test_community_owner";
const definers = ["public.community_definer_reset()", "public.community_public(text,text)", "public.community_enter(text,integer,boolean,text,uuid)",
  "public.discover_communities(text,boolean,timestamptz,uuid,integer)", "public.community_my_invites()"];
const tables = ["communities", "community_memberships", "entitlements", "community_invites", "audit_logs", "workspaces", "discover_listings"];
let fixture: Awaited<ReturnType<typeof testDatabase>>, tenant: string, open: string, hidden: string;
let roleCreated = false;
const copied: { table: string; name: string }[] = [];

beforeAll(async () => {
  fixture = await testDatabase();
  await fixture.db.insert(users).values(["o-owner", "o-joiner", "o-invited"].map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  tenant = (await createWorkspace(fixture.db, "o-owner", "Owner test", "church")).tenantId;
  open = (await createCommunity(fixture.db, "o-owner", tenant, { name: "Open", slug: "owner-open" })).id;
  hidden = (await createCommunity(fixture.db, "o-owner", tenant, { name: "Hidden", slug: "owner-hidden" })).id;
  await fixture.admin.query("update communities set status = 'published', visibility = 'listed', allow_open = true where id = $1", [open]);
  await fixture.admin.query("update communities set status = 'published' where id = $1", [hidden]);
  await fixture.admin.query(`insert into discover_listings (resource_type, resource_id, tenant_id, slug, name, host_name, pricing, admission, search_text)
    values ('community', $1, $2, 'owner-open', 'Open', 'Owner test', 'free', '{open}', 'open owner test')`, [open, tenant]);

  await fixture.admin.query(`create role ${role} nologin nosuperuser nobypassrls noinherit`);
  roleCreated = true;
  await fixture.admin.query(`grant usage on schema public to ${role}`);
  await fixture.admin.query(`grant select, insert, update, delete on ${tables.join(", ")} to ${role}`);
  await fixture.admin.query(`grant select on users to ${role}`);
  const { rows: [{ owner }] } = await fixture.admin.query("select current_user as owner");
  const { rows: policies } = await fixture.admin.query(`select tablename, policyname, cmd, qual, with_check from pg_policies
    where schemaname = 'public' and tablename = any($1) and $2 = any(roles) and policyname like any(array['community_definer%', 'discover_definer%'])`, [tables, owner]);
  // Every table the definers touch has an owner policy, and none is unconditional.
  expect([...new Set(policies.map((policy) => policy.tablename))].sort()).toEqual([...tables].sort());
  for (const policy of policies) expect(`${policy.qual ?? ""} ${policy.with_check ?? ""}`, `${policy.tablename}.${policy.policyname}`).toMatch(/current_setting/);
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

it("resolves, lists, joins, redeems and lists invites with a non-bypass definer owner", async () => {
  const { rows: [owner] } = await fixture.admin.query(`select r.rolsuper, r.rolbypassrls, (select count(distinct proowner)::int from pg_proc where oid = any($1::regprocedure[])) as owners
    from pg_roles r where r.rolname = $2`, [definers, role]);
  expect(owner).toEqual({ rolsuper: false, rolbypassrls: false, owners: 1 });
  const view = (slug: string, hash: string | null = null) => fixture.db.transaction(async (tx) => (await tx.execute<{ v: { name: string; hostName: string } | null }>(sql`select public.community_public(${slug}, ${hash}) as v`)).rows[0].v);
  const enter = (user: string, slug: string, hash: string | null) => withUser(fixture.db, user, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${slug}, 0, true, ${hash}, null) as o`)).rows[0].o);
  expect(await view("owner-open")).toMatchObject({ name: "Open", hostName: "Owner test" });
  expect(await view("owner-hidden")).toBeNull();
  expect((await fixture.db.transaction((tx) => tx.execute(sql`select public.discover_communities('', false, null, null, 24) as v`))).rows).toHaveLength(1);
  expect(await enter("o-joiner", "owner-open", null)).toBe("joined");
  const token = newInviteToken();
  await fixture.admin.query(`insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, created_by, expires_at)
    values ($1, $2, $3, $4, $5, 'o-owner', now() + interval '1 day')`, [tenant, hidden, emailHash("o-invited@example.test"), emailHint("o-invited@example.test"), hashSecret(token)]);
  expect(await view("owner-hidden", hashSecret(token))).toMatchObject({ name: "Hidden" });
  expect(await withUser(fixture.db, "o-invited", async (tx) => (await tx.execute(sql`select public.community_my_invites() as v`)).rows)).toHaveLength(1);
  expect(await enter("o-invited", "owner-hidden", hashSecret(token))).toBe("joined");
  expect((await fixture.admin.query("select action from audit_logs where tenant_id = $1 and action in ('community.join', 'community.invite_redeem') order by created_at", [tenant])).rows.map((r) => r.action))
    .toEqual(["community.join", "community.invite_redeem"]);
});
