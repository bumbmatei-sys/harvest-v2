import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { testDatabase } from "../database";
import { users } from "../../src/db/schema";
import { withTenant, withUser } from "../../src/server/tenancy";
import { createWorkspace } from "../../src/server/workspaces";
import { createCommunity } from "../../src/server/communities";
import { emailHash, emailHint, hashSecret, newInviteToken } from "../../src/lib/community-listing";

let f: Awaited<ReturnType<typeof testDatabase>>, a: string, b: string, open: string, hidden: string;
const people = ["j-owner", "j-b-owner", "j-joiner", "j-invited", "j-other", "j-banned"];
const enter = (user: string, slug: string, version: number, adult: boolean, hash: string | null = null, id: string | null = null) =>
  withUser(f.db, user, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${slug}, ${version}, ${adult}, ${hash}, ${id}::uuid) as o`)).rows[0].o);
const publicView = (slug: string, hash: string | null = null) => f.db.transaction(async (tx) => (await tx.execute<{ v: Record<string, unknown> | null }>(sql`select public.community_public(${slug}, ${hash}) as v`)).rows[0].v);

beforeAll(async () => {
  f = await testDatabase();
  await f.db.insert(users).values(people.map((id) => ({ id, name: id, email: `${id}@example.test`, emailVerified: true })));
  a = (await createWorkspace(f.db, "j-owner", "Grace Church", "church")).tenantId;
  b = (await createWorkspace(f.db, "j-b-owner", "Other", "creator")).tenantId;
  open = (await createCommunity(f.db, "j-owner", a, { name: "Open study", slug: "open-study" })).id;
  hidden = (await createCommunity(f.db, "j-owner", a, { name: "Secret team", slug: "secret-team" })).id;
  await f.admin.query("update communities set status = 'published', visibility = 'listed', allow_open = true, rules = 'Be kind.', rules_version = 1 where id = $1", [open]);
  await f.admin.query("update communities set status = 'published', visibility = 'hidden' where id = $1", [hidden]);
});
afterAll(async () => { await f?.close(); });

it("shows published listed communities, hides drafts and hidden ones without an invite", async () => {
  expect(await publicView("open-study")).toMatchObject({ name: "Open study", hostName: "Grace Church", rules: "Be kind.", rulesVersion: 1, invited: false });
  expect(await publicView("secret-team")).toBeNull();
  expect(await publicView("no-such-community")).toBeNull();
  await f.admin.query("update communities set status = 'draft' where id = $1", [open]);
  expect(await publicView("open-study")).toBeNull();
  await f.admin.query("update communities set status = 'published' where id = $1", [open]);
});

it("joins with current rules and adult confirmation, idempotently, and refuses the rest", async () => {
  expect(await enter("j-joiner", "open-study", 0, true)).toBe("rules_changed");
  expect(await enter("j-joiner", "open-study", 1, false)).toBe("adult_required");
  expect(await enter("j-joiner", "secret-team", 0, true)).toBe("not_found");
  expect(await enter("j-joiner", "open-study", 1, true)).toBe("joined");
  expect(await enter("j-joiner", "open-study", 1, true)).toBe("already_member");
  const { rows } = await f.admin.query("select role, status, rules_version_accepted, adult_confirmed_at is not null as adult from community_memberships where user_id = 'j-joiner'");
  expect(rows).toEqual([{ role: "member", status: "active", rules_version_accepted: 1, adult: true }]);
  expect((await f.admin.query("select source from entitlements where user_id = 'j-joiner'")).rows).toEqual([{ source: "community_free_join" }]);
  expect((await f.admin.query("select action from audit_logs where actor_id = 'j-joiner'")).rows).toEqual([{ action: "community.join" }]);
  await f.admin.query("update communities set allow_open = false where id = $1", [open]);
  expect(await enter("j-other", "open-study", 1, true)).toBe("not_allowed");
  await f.admin.query("update communities set allow_open = true where id = $1", [open]);
  await f.admin.query("insert into community_memberships (tenant_id, community_id, user_id, role, status) values ($1, $2, 'j-banned', 'member', 'banned')", [a, open]);
  expect(await enter("j-banned", "open-study", 1, true)).toBe("banned");
  await expect(f.db.transaction((tx) => tx.execute(sql`select public.community_enter('open-study', 1, true, null, null)`))).rejects.toMatchObject({ cause: { code: "42501" } });
});

it("redeems a personal invite once, only for the invited email, before expiry and revocation", async () => {
  const token = newInviteToken(), stale = newInviteToken(), revoked = newInviteToken();
  const insert = (t: string, email: string, expires = "now() + interval '14 days'") => f.admin.query(
    `insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, created_by, expires_at) values ($1, $2, $3, $4, $5, 'j-owner', ${expires}) returning id`,
    [a, hidden, emailHash(email), emailHint(email), hashSecret(t)]);
  await insert(token, "j-invited@example.test");
  expect(await publicView("secret-team", hashSecret(token))).toMatchObject({ name: "Secret team", invited: true });
  expect(await enter("j-other", "secret-team", 0, true, hashSecret(token))).toBe("invite_invalid");
  expect(await enter("j-invited", "open-study", 1, true, hashSecret(token))).toBe("invite_invalid");
  expect(await enter("j-invited", "secret-team", 0, true, hashSecret(token))).toBe("joined");
  expect(await enter("j-invited", "secret-team", 0, true, hashSecret(token))).toBe("invite_invalid");
  expect((await f.admin.query("select source, granted_by from entitlements where user_id = 'j-invited'")).rows).toEqual([{ source: "invitation", granted_by: "j-owner" }]);
  await insert(stale, "j-other@example.test", "now() - interval '1 minute'");
  expect(await enter("j-other", "secret-team", 0, true, hashSecret(stale))).toBe("invite_invalid");
  // An expired invite still blocks a second open one for the same address; createInvite revokes it first.
  await f.admin.query("update community_invites set revoked_at = now() where token_hash = $1", [hashSecret(stale)]);
  const { rows: [{ id }] } = await insert(revoked, "j-other@example.test");
  await f.admin.query("update community_invites set revoked_at = now() where id = $1", [id]);
  expect(await enter("j-other", "secret-team", 0, true, null, id)).toBe("invite_invalid");
});

it("lists a person's own open invitations only", async () => {
  await f.admin.query(`insert into community_invites (tenant_id, community_id, email_hash, email_hint, token_hash, expires_at) values ($1, $2, $3, 'j•••@example.test', $4, now() + interval '1 day')`,
    [a, hidden, emailHash("j-joiner@example.test"), hashSecret(newInviteToken())]);
  const mine = await withUser(f.db, "j-joiner", async (tx) => (await tx.execute<{ v: { slug: string } }>(sql`select public.community_my_invites() as v`)).rows.map((r) => r.v.slug));
  expect(mine).toEqual(["secret-team"]);
  expect(await withUser(f.db, "j-b-owner", async (tx) => (await tx.execute(sql`select public.community_my_invites()`)).rows)).toEqual([]);
});

it("returns Discover rows only from the projection, filtered and paged", async () => {
  await f.admin.query(`insert into discover_listings (resource_type, resource_id, tenant_id, slug, name, tagline, host_name, pricing, admission, search_text)
    values ('community', $1, $2, 'open-study', 'Open study', null, 'Grace Church', 'free', '{open,invite}', 'open study grace church')`, [open, a]);
  const find = (q: string, openOnly = false) => f.db.transaction(async (tx) => (await tx.execute<{ v: { slug: string } }>(sql`select public.discover_communities(${q}, ${openOnly}, null, null, 24) as v`)).rows.map((r) => r.v.slug));
  expect(await find("")).toEqual(["open-study"]);
  expect(await find("GRACE")).toEqual(["open-study"]);
  expect(await find("%")).toEqual([]);
  expect(await find("nothing")).toEqual([]);
});

it("keeps invites and listings out of reach of members, visitors and other ministries", async () => {
  expect(await withUser(f.db, "j-joiner", async (tx) => (await tx.execute(sql`select * from community_invites`)).rows)).toEqual([]);
  expect(await withUser(f.db, "j-joiner", async (tx) => (await tx.execute(sql`select * from discover_listings`)).rows)).toEqual([]);
  expect(await withTenant(f.db, "j-b-owner", b, "communities:manage", async (tx) => (await tx.execute(sql`select * from community_invites`)).rows)).toEqual([]);
  expect((await f.admin.query("select count(*)::int as n from community_invites where token_hash !~ '^[a-f0-9]{64}$' or email_hash !~ '^[a-f0-9]{64}$'")).rows[0].n).toBe(0);
});
