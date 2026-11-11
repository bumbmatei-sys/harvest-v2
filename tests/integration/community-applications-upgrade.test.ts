import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

// 0037 replaces the free-text rules column with a list. Existing rules must be carried over even when the migration
// owner obeys FORCE RLS without BYPASSRLS (the copy runs under a policy that lives only inside the migration).
let f: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true, beforeCommunityApplicationsMigration: async (admin) => {
    await admin.query("insert into users (id, name, email) values ('u-rules', 'u-rules', 'u-rules@example.test')");
    const { rows: [w] } = await admin.query("insert into workspaces (name, created_by) values ('Rules Church', 'u-rules') returning tenant_id");
    await admin.query("insert into communities (tenant_id, slug, name, rules, rules_version) values ($1, 'with-rules', 'With rules', 'Be kind.', 1), ($1, 'no-rules', 'No rules', null, 0)", [w.tenant_id]);
  } });
});
afterAll(async () => { await f?.close(); });

it("copies existing rules into the list as a restricted owner and leaves no migration policy behind", async () => {
  expect(f.migrationOwner).toBeTruthy();
  const { rows } = await f.admin.query("select slug, rules_list, rules_version from communities order by slug");
  expect(rows).toEqual([{ slug: "no-rules", rules_list: [], rules_version: 0 }, { slug: "with-rules", rules_list: ["Be kind."], rules_version: 1 }]);
  expect((await f.admin.query("select count(*)::int as n from pg_policies where policyname = 'community_migration_0037'")).rows[0].n).toBe(0);
  expect((await f.admin.query("select count(*)::int as n from information_schema.columns where table_name = 'communities' and column_name = 'rules'")).rows[0].n).toBe(0);
});
