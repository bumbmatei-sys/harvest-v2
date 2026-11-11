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
const definers = ["public.community_definer_reset()", "public.community_public(text,text)", "public.community_enter(text,integer,integer,jsonb,boolean,text,uuid)", "public.community_my_applications()", "public.community_application_update(uuid,text,jsonb,integer)", "public.community_purge_applications()", "public.community_answers_valid(jsonb,jsonb)", "public.community_forum_actor(text)", "public.community_forum_done(text,uuid)", "public.community_can_read(uuid,uuid)",
  "public.community_post_save(text,uuid,uuid,text,jsonb,text,text,uuid,uuid[],boolean,boolean)", "public.community_post_delete(text,uuid)", "public.community_comment_save(text,uuid,uuid,text)",
  "public.community_comment_delete(text,uuid)", "public.community_like_toggle(text,text,uuid)", "public.community_moderate(text,text,uuid)",
  "public.community_file_create(text,uuid,text,text,text,integer,text)", "public.community_file_set_status(text,uuid,text)",
  "public.discover_communities(text,boolean,timestamptz,uuid,integer)", "public.community_my_invites()"];
const tables = ["communities", "community_memberships", "entitlements", "community_invites", "audit_logs", "workspaces", "discover_listings", "community_applications", "community_categories", "community_files", "community_posts", "community_comments", "community_likes"];
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
  const enter = (user: string, slug: string, hash: string | null) => withUser(fixture.db, user, async (tx) => (await tx.execute<{ o: string }>(sql`select public.community_enter(${slug}, 0, 0, '{}'::jsonb, true, ${hash}, null) as o`)).rows[0].o);
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

it("applies, lists, resubmits, withdraws and purges applications with a non-bypass definer owner", async () => {
  await fixture.admin.query(`update communities set allow_apply = true, join_questions = '[{"id":"aaaaaaaa","type":"short","label":"City","required":true}]'::jsonb,
    questions_version = 1 where id = $1`, [open]);
  const apply = (answers: unknown) => withUser(fixture.db, "o-applicant", async (tx) =>
    (await tx.execute<{ o: string }>(sql`select public.community_enter('owner-open', 0, 1, ${JSON.stringify(answers)}::jsonb, true, null, null) as o`)).rows[0].o);
  await fixture.db.insert(users).values({ id: "o-applicant", name: "o-applicant", email: "o-applicant@example.test", emailVerified: true });
  expect(await apply({})).toBe("answers_invalid");
  expect(await apply({ aaaaaaaa: "Cluj" })).toBe("applied");
  const [mine] = await withUser(fixture.db, "o-applicant", async (tx) => (await tx.execute<{ v: { id: string } }>(sql`select public.community_my_applications() as v`)).rows.map((r) => r.v));
  await fixture.admin.query("update community_applications set status = 'info_requested', info_request = 'More?' where id = $1", [mine.id]);
  const update = (action: string) => withUser(fixture.db, "o-applicant", async (tx) =>
    (await tx.execute<{ o: string }>(sql`select public.community_application_update(${mine.id}::uuid, ${action}, '{"aaaaaaaa":"Iasi"}'::jsonb, 1) as o`)).rows[0].o);
  expect(await update("resubmit")).toBe("updated");
  expect(await update("withdraw")).toBe("updated");
  await fixture.admin.query("update community_applications set decided_at = now() - interval '91 days' where id = $1", [mine.id]);
  expect(await fixture.db.transaction(async (tx) => (await tx.execute<{ n: number }>(sql`select public.community_purge_applications() as n`)).rows[0].n)).toBe(1);
});

it("posts, replies, likes, moderates and uploads with a non-bypass definer owner", async () => {
  const run = async <T,>(user: string, statement: ReturnType<typeof sql>) => withUser(fixture.db, user, async (tx) => (await tx.execute<{ v: T }>(statement)).rows[0].v);
  const category = (await fixture.admin.query("select id from community_categories where community_id = $1 limit 1", [open])).rows[0].id;
  const body = JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] });
  const file = crypto.randomUUID();
  expect((await run<{ outcome: string }>("o-joiner", sql`select public.community_file_create('owner-open', ${file}::uuid, 'attachment', 'a.pdf', 'application/pdf', 10, ${"a".repeat(64)}) as v`)).outcome).toBe("ok");
  for (const status of ["uploaded", "ready"]) expect((await run<{ outcome: string }>("o-joiner", sql`select public.community_file_set_status('owner-open', ${file}::uuid, ${status}) as v`)).outcome).toBe("ok");
  const post = await run<{ outcome: string; id: string }>("o-joiner", sql`select public.community_post_save('owner-open', null, ${category}::uuid, 'Hello', ${body}::jsonb, 'Hi', null, null, ${`{${file}}`}::uuid[], false, false) as v`);
  expect(post.outcome).toBe("ok");
  const comment = await run<{ outcome: string; id: string }>("o-owner", sql`select public.community_comment_save('owner-open', ${post.id}::uuid, null, 'Welcome') as v`);
  expect(comment.outcome).toBe("ok");
  expect((await run<{ outcome: string }>("o-owner", sql`select public.community_like_toggle('owner-open', 'post', ${post.id}::uuid) as v`)).outcome).toBe("liked");
  expect((await run<{ outcome: string }>("o-owner", sql`select public.community_moderate('owner-open', 'pin', ${post.id}::uuid) as v`)).outcome).toBe("ok");
  expect((await run<{ outcome: string }>("o-joiner", sql`select public.community_comment_delete('owner-open', ${comment.id}::uuid) as v`)).outcome).toBe("forbidden");
  expect((await run<{ outcome: string }>("o-joiner", sql`select public.community_post_delete('owner-open', ${post.id}::uuid) as v`)).outcome).toBe("ok");
});
