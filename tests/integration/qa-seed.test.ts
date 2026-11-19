import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";
import { seedQaData } from "../../scripts/qa-seed-data";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase({ migrationOwner: true }); });
afterAll(async () => { await fixture?.close(); });

it("seeds deterministic fixtures twice, resets only seed data, and rejects non-synthetic accounts", async () => {
  await fixture.admin.query(`grant harvest_app to ${fixture.migrationOwner}`);
  await fixture.admin.query(`set role ${fixture.migrationOwner}`);
  const initial = await seedQaData(fixture.admin, false);
  // The operator logs in as the owner. The harness substitutes session role on a root connection.
  await fixture.admin.query(`set role ${fixture.migrationOwner}`);
  expect(await seedQaData(fixture.admin, false)).toEqual(initial);
  await fixture.admin.query("reset role");
  expect((await fixture.admin.query("select count(*)::int n from users")).rows[0].n).toBe(12);
  expect((await fixture.admin.query("select count(*)::int n from community_posts")).rows[0].n).toBe(20);
  expect((await fixture.admin.query("select count(*)::int n from community_comments")).rows[0].n).toBe(20);
  const { rows: [applicant] } = await fixture.admin.query(
    "select tenant_id,community_id,user_id from community_applications where status='pending' order by id limit 1");
  const scope = [applicant.tenant_id, applicant.community_id, applicant.user_id];
  await fixture.admin.query("update community_applications set status='approved' where tenant_id=$1 and community_id=$2 and user_id=$3", scope);
  await fixture.admin.query("update community_memberships set status='active',joined_at=now() where tenant_id=$1 and community_id=$2 and user_id=$3", scope);
  await fixture.admin.query("insert into entitlements(tenant_id,resource_type,resource_id,user_id,source) values($1,'community',$2,$3,'application')", scope);
  await fixture.admin.query("update community_posts set title='Changed' where title='Test discussion 1'");
  await fixture.admin.query(`set role ${fixture.migrationOwner}`);
  expect(await seedQaData(fixture.admin, true)).toEqual(initial);
  await fixture.admin.query("reset role");
  expect((await fixture.admin.query("select status from community_memberships where tenant_id=$1 and community_id=$2 and user_id=$3", scope)).rows)
    .toEqual([{ status: "pending" }]);
  expect((await fixture.admin.query("select revoked_at from entitlements where tenant_id=$1 and resource_id=$2 and user_id=$3 and source='application'", scope)).rows[0].revoked_at)
    .toBeInstanceOf(Date);
  expect((await fixture.admin.query("select count(*)::int n from community_posts where title='Changed'")).rows[0].n).toBe(0);
  await fixture.admin.query("insert into users(id,name,email) values ('pollution','Synthetic outside allow-list','fake@example.invalid')");
  await expect(seedQaData(fixture.admin, false)).rejects.toThrow("QA_SEED_NON_SYNTHETIC_USERS");
});

it("removes complete and interrupted walkthroughs while preserving unrelated QA fixtures", async () => {
  await fixture.admin.query("delete from users where id='pollution'");
  const { createWorkspace: makeMinistry } = await import("../../src/server/workspaces");
  const { createCommunity } = await import("../../src/server/communities");
  const run = "123456781234123412341234567890ab";
  const interrupted = "abcdef001234123412341234567890ab";
  const owner = `owner-${run}@qa.harvest.invalid`;
  const member = `member-${run}@qa.harvest.invalid`;
  const orphan = `owner-${interrupted}@qa.harvest.invalid`;
  await fixture.admin.query("insert into users(id,name,email) select email,'QA',email from unnest($1::text[]) as email", [[owner, member, orphan, "unrelated@qa.harvest.invalid"]]);
  const ministry = await makeMinistry(fixture.db, owner, "QA Ministry 12345678", "church");
  const circle = await createCommunity(fixture.db, owner, ministry.tenantId, { name: "QA Circle 12345678", slug: `qa-${run}` });
  const partial = await makeMinistry(fixture.db, orphan, "QA Ministry abcdef00", "church");
  const { rows: [category] } = await fixture.admin.query("select id from community_categories where community_id=$1", [circle.id]);
  const rows = [ministry.tenantId, circle.id, member, category.id];
  await fixture.admin.query("insert into community_memberships(tenant_id,community_id,user_id,role,status) values($1,$2,$3,'member','active')", rows.slice(0, 3));
  await fixture.admin.query("insert into entitlements(tenant_id,resource_type,resource_id,user_id,source) values($1,'community',$2,$3,'application')", rows.slice(0, 3));
  const { rows: [post] } = await fixture.admin.query(
    "insert into community_posts(tenant_id,community_id,author_id,category_id,title,body,body_text) values($1,$2,$3,$4,'Walkthrough','{}','test') returning id", rows);
  await fixture.admin.query(
    "insert into community_comments(tenant_id,community_id,post_id,author_id,body) values($1,$2,$3,$4,'test')", [ministry.tenantId, circle.id, post.id, owner]);
  await fixture.admin.query(
    "insert into community_reports(tenant_id,community_id,target_type,target_id,reporter_id,reason) values($1,$2,'post',$3,$4,'other')", [ministry.tenantId, circle.id, post.id, owner]);
  await fixture.admin.query("insert into audit_logs(actor_id,action) values ($1,'auth.sign_in')", [member]);
  await fixture.admin.query("insert into otp_cooldowns(email,sent_at) values ($1,now()), ($2,now())", [owner, "unrelated@qa.harvest.invalid"]);

  async function reset() {
    await fixture.admin.query(`set role ${fixture.migrationOwner}`);
    try { await seedQaData(fixture.admin, true); }
    finally { await fixture.admin.query("reset role"); }
  }

  const unrelated = await makeMinistry(fixture.db, "unrelated@qa.harvest.invalid", "Unrelated QA", "church");
  await fixture.admin.query("insert into workspace_members(tenant_id,user_id,role_id) values($1,$2,'viewer')", [unrelated.tenantId, member]);
  await expect(reset()).rejects.toThrow("QA_SEED_WALKTHROUGH_SCOPE");
  expect((await fixture.admin.query("select id from communities where id=$1", [circle.id])).rowCount).toBe(1);
  await fixture.admin.query("delete from workspace_members where tenant_id=$1 and user_id=$2", [unrelated.tenantId, member]);
  await reset();
  await reset();

  expect((await fixture.admin.query("select id from users where id=any($1::text[])", [[owner, member, orphan]])).rowCount).toBe(0);
  expect((await fixture.admin.query("select tenant_id from workspaces where tenant_id=any($1::uuid[])", [[ministry.tenantId, partial.tenantId, unrelated.tenantId]])).rows)
    .toEqual([{ tenant_id: unrelated.tenantId }]);
  expect((await fixture.admin.query("select id from communities where id=$1", [circle.id])).rowCount).toBe(0);
  expect((await fixture.admin.query("select id from community_posts where id=$1", [post.id])).rowCount).toBe(0);
  expect((await fixture.admin.query("select email from otp_cooldowns where email=any($1::text[])", [[owner, "unrelated@qa.harvest.invalid"]])).rows)
    .toEqual([{ email: "unrelated@qa.harvest.invalid" }]);
  await expect(fixture.admin.query("delete from audit_logs")).rejects.toThrow("audit_logs are append-only");
});
