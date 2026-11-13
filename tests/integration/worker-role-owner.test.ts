import { expect, it } from "vitest";
import { testDatabase } from "../database";

// Run as a non-superuser (the migration owner has NOCREATEROLE and FORCE RLS applies to it): 0044's revoke and conditional grant must not need more.
const workerFunctions = [
  ["public.community_email_enqueue(integer)", "select public.community_email_enqueue(1)"],
  ["public.community_email_claim(integer)", "select public.community_email_claim(1)"],
  ["public.community_email_complete(uuid,text,text)", "select public.community_email_complete(gen_random_uuid(), 'sent', null)"],
  ["public.connect_retention_sweep(integer)", "select public.connect_retention_sweep(1)"],
  ["public.connect_retention_record_failure(text)", "select public.connect_retention_record_failure('sweep_failed')"],
  ["public.connect_retention_health()", "select public.connect_retention_health()"],
] as const;

it("works with a restricted (non-superuser, NOCREATEROLE) migration owner", async () => {
  const restricted = await testDatabase({ migrationOwner: true });
  try {
    for (const [signature, call] of workerFunctions) {
      expect((await restricted.admin.query("select has_function_privilege('harvest_worker', $1, 'execute') as ok", [signature])).rows[0].ok, signature).toBe(true);
      await expect(restricted.workerPool.query(call), signature).resolves.toBeDefined();
      await expect(restricted.pool.query(call), signature).rejects.toMatchObject({ code: "42501" });
    }
  } finally { await restricted.close(); }
});
