import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testDatabase } from "../database";
import { useKeyProvider } from "../../src/server/connect-key-provider";
import { runSocialPublisher } from "../../src/server/social/publisher";
import { linkConnection, schedulePost } from "../../src/server/social/service";
import { receiveSocialWebhook } from "../../src/server/social/webhook";
import { drainJobs } from "../../src/server/jobs/service";
import { CANARY, depsFor, event, newFake, seedPeople, signedRequest, useTestKeys } from "./social-layer-fixture";

// The migration owner is a real non-superuser, non-BYPASSRLS role (run as `tester` locally): FORCE row security applies to the
// SECURITY DEFINER owner too, so the definers only work through their owner policies. Everything must still work, and the guards still fire.
it("claims, completes and resolves as a restricted owner, and the triggers and tenant isolation still hold", async () => {
  const f = await testDatabase({ migrationOwner: true });
  try {
    useTestKeys();
    const { rows: [owner] } = await f.admin.query("select rolsuper, rolbypassrls from pg_roles where rolname = $1", [f.migrationOwner]);
    expect(owner).toEqual({ rolsuper: false, rolbypassrls: false });
    const p = await seedPeople(f, "so"), fake = newFake(), deps = depsFor(fake);
    const connection = (await linkConnection(f.db, p.owner, p.tenant, { provider: "fake", credential: CANARY, accountRef: "acc-ig-1" }, deps)).connection.id;
    const post = (await schedulePost(f.db, p.owner, p.tenant, { connectionId: connection, content: "owner path", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }, deps)).post;
    // f.admin is the cluster superuser here (RESET ROLE after migrating); the objects themselves are owned by the restricted role.
    await f.admin.query("update social_posts set scheduled_for = now() - interval '1 second', next_attempt_at = now() - interval '1 second' where id = $1", [post.id]);
    expect((await f.admin.query("select r.rolname, r.rolsuper from pg_class c join pg_roles r on r.oid = c.relowner where c.relname = 'social_posts'")).rows[0]).toEqual({ rolname: f.migrationOwner, rolsuper: false });
    expect(await runSocialPublisher(f.workerPool, () => fake)).toMatchObject({ claimed: 1, published: 1 });
    expect((await f.pool.query("select * from public.social_resolve_account('fake', 'acc-ig-1')")).rows).toEqual([{ tenant_id: p.tenant, connection_id: connection }]);
    const res = await receiveSocialWebhook(f.db, signedRequest(event("so-1", "message.received", { subjectRef: "c1" })), "fake", deps);
    expect(res.status).toBe(202);
    expect((await drainJobs(f.db, p.owner, p.tenant, "w")).results.map((r) => r.status)).toEqual(["succeeded"]);
    // Tenant isolation and the role check survive FORCE RLS.
    await expect(f.workerPool.query("select * from social_posts")).rejects.toMatchObject({ code: "42501" });
    await expect(f.pool.query("select public.social_publish_claim(1, 60)")).rejects.toMatchObject({ code: "42501" });
    const { rows: policies } = await f.admin.query("select polname, polroles::regrole[]::text as roles from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('social_connections','social_posts') order by 1");
    expect(policies.map((r) => r.polname)).toEqual(["social_connections_admin", "social_connections_definer", "social_posts_admin", "social_posts_definer"]);
    expect(policies.filter((r) => r.polname.endsWith("_definer")).every((r) => r.roles.includes(f.migrationOwner!))).toBe(true);
  } finally { useKeyProvider(null); await f.close(); }
}, 60_000);
