import { afterAll, beforeAll, expect, it } from "vitest";
import { testDatabase } from "../database";

let fixture: Awaited<ReturnType<typeof testDatabase>>;
beforeAll(async () => { fixture = await testDatabase({ migrationOwner: true }); });
afterAll(async () => { await fixture?.close(); });

it("applies as a restricted owner with forced RLS and a hygienic due-notice guard", async () => {
  expect(fixture.migrationOwner).toBeTruthy();
  const { rows } = await fixture.admin.query("select relname, relforcerowsecurity from pg_class where relname in ('crm_notification_preferences','crm_notifications') order by relname");
  expect(rows.every((row) => row.relforcerowsecurity)).toBe(true);
  const { rows: [acl] } = await fixture.admin.query(`select has_function_privilege('public', oid, 'execute') as public, proconfig as settings
    from pg_proc where oid = 'public.guard_crm_due_notification()'::regprocedure`);
  expect(acl).toEqual({ public: false, settings: ["search_path=pg_catalog, pg_temp"] });
});
