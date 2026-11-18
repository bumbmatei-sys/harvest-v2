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
