import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// Migration 0125 as the NOBYPASSRLS migration owner: an enabled pause rule stored before it (ads_rules has FORCE RLS) is switched off with its version bumped,
// an enabled flag rule is untouched, and the definer flag is not left behind.
const tenant = randomUUID(), account = randomUUID(), pause = randomUUID(), flag = randomUUID();
let f: Awaited<ReturnType<typeof testDatabase>>;

beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true, beforeAdsRulesFlagOnlyMigration: async (admin) => {
    // Seeded as the cluster superuser with foreign-key triggers off: only the rule rows matter here, and the 0098 CHECK still applies.
    await admin.query("SET session_replication_role = replica");
    for (const [id, action] of [[pause, "pause"], [flag, "notify"]] as const) {
      await admin.query(`insert into ads_rules (tenant_id, id, ad_account_id, name, level, condition, action, enabled, version, created_by)
        values ($1, $2, $3, $4, 'campaign', '{"metric":"spend","operator":"gt","threshold":1,"windowDays":1}', $5, true, 3, 'seed-user')`, [tenant, id, account, `Old ${action}`, action]);
    }
    await admin.query("SET session_replication_role = origin");
  } });
});
afterAll(async () => { await f?.close(); });

it("switches the stored pause rule off and bumps its version, keeps the flag rule, and leaves no definer flag", async () => {
  const { rows } = await f.admin.query("select id, action, enabled, version from ads_rules where tenant_id = $1 order by action", [tenant]);
  expect(rows).toEqual([{ id: flag, action: "notify", enabled: true, version: 3 }, { id: pause, action: "pause", enabled: false, version: 4 }]);
  expect((await f.admin.query("select coalesce(current_setting('app.ads_definer', true), '') as v")).rows[0].v).toBe("");
  // The tightened CHECK keeps it off.
  await expect(f.admin.query("update ads_rules set enabled = true where id = $1", [pause])).rejects.toMatchObject({ code: "23514" });
});
