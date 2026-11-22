import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { createCommunity } from "../../src/server/communities";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";
import { jobLease } from "../../src/worker/jobs/lease";

vi.mock("server-only", () => ({}));

let fixture: Awaited<ReturnType<typeof testDatabase>>;
const dispatch = { job: "connect_retention", scheduledTime: Date.UTC(2026, 10, 21) } as const;
const bindings = () => ({ WORKER_HYPERDRIVE: { connectionString: fixture.workerURL } });

beforeAll(async () => { fixture = await testDatabase({ migrationOwner: true }); });
afterAll(async () => { await fixture?.close(); });

it("applies as a restricted owner and exposes only the narrow lease functions", async () => {
  expect(fixture.migrationOwner).toBeTruthy();
  const signatures = ["worker_job_acquire(text,timestamptz,uuid,integer)", "worker_job_fence(text,uuid)",
    "worker_job_renew(text,uuid,integer)", "worker_job_finish(text,uuid,boolean)",
    "community_purge_applications(integer)", "community_purge_notifications(integer)"];
  for (const signature of signatures) {
    const { rows: [acl] } = await fixture.admin.query(`
      select has_function_privilege('harvest_app', oid, 'execute') as app,
        has_function_privilege('harvest_worker', oid, 'execute') as worker,
        has_function_privilege('public', oid, 'execute') as public,
        proconfig as settings, proowner::regrole::text as owner
      from pg_proc where oid = $1::regprocedure`, [`public.${signature}`]);
    expect(acl).toEqual({ app: false, worker: true, public: false,
      settings: ["search_path=pg_catalog, pg_temp"], owner: fixture.migrationOwner });
  }
  for (const role of [fixture.pool, fixture.workerPool]) {
    for (const table of ["worker_job_leases", "worker_job_receipts"]) {
      await expect(role.query(`select * from public.${table}`)).rejects.toMatchObject({ code: "42501" });
    }
  }
  await expect(jobLease({ WORKER_HYPERDRIVE: { connectionString: fixture.appURL } }, dispatch).acquire())
    .rejects.toThrow("DATABASE_URL_INVALID");
});

it("admits one concurrent holder, renews it, recovers a crash and refuses stale writes", async () => {
  const contenders = [jobLease(bindings(), dispatch, 15), jobLease(bindings(), dispatch, 15)];
  const results = await Promise.all(contenders.map(lease => lease.acquire()));
  expect(results.toSorted()).toEqual(["acquired", "busy"]);
  const holder = contenders[results.indexOf("acquired")];
  await fixture.admin.query("update public.worker_job_leases set expires_at = clock_timestamp() + interval '5 seconds'");
  await holder.renew();
  expect((await fixture.admin.query("select expires_at - clock_timestamp() > interval '5 seconds' as extended from public.worker_job_leases")).rows[0].extended).toBe(true);

  // Simulate elapsed DB time for an invocation that died without settlement.
  await fixture.admin.query("update public.worker_job_leases set expires_at = clock_timestamp() - interval '1 second'");
  await expect(holder.renew()).rejects.toThrow("WORKER_JOB_LEASE_LOST");
  const write = async () => { throw new Error("STALE_CALLBACK_RAN"); };
  await expect(holder.transaction(write, true)).rejects.toThrow("WORKER_JOB_LEASE_LOST");
  const recovery = jobLease(bindings(), dispatch);
  expect(await recovery.acquire()).toBe("acquired");
  await expect(holder.finish(true)).rejects.toThrow("WORKER_JOB_LEASE_LOST");
  await recovery.transaction(async connection => {
    await connection.query("select public.connect_retention_record_failure('sweep_failed')");
  }, true);
  await expect(jobLease(bindings(), dispatch).acquire()).resolves.toBe("duplicate");
});

it("rolls back a write that loses its lease before settlement", async () => {
  const lease = jobLease(bindings(), { ...dispatch, scheduledTime: dispatch.scheduledTime + 1 }, 3);
  expect(await lease.acquire()).toBe("acquired");
  const before = (await fixture.admin.query("select count(*)::int as count from public.connect_retention_runs")).rows[0].count;
  let wrote = false;
  await expect(lease.transaction(async connection => {
    await connection.query("select public.connect_retention_record_failure('sweep_failed')");
    wrote = true;
    await connection.query("select pg_sleep(3.1)");
  }, true)).rejects.toThrow("WORKER_JOB_LEASE_LOST");
  expect(wrote).toBe(true);
  const after = (await fixture.admin.query("select count(*)::int as count from public.connect_retention_runs")).rows[0].count;
  expect(after).toBe(before);
});

it("purges only eligible rows in bounded worker batches under FORCE RLS", async () => {
  const owner = "cf04-purge-owner";
  await fixture.db.insert(users).values({ id: owner, name: "Fixture", email: "cf04-purge@example.test", emailVerified: true });
  const { tenantId } = await createWorkspace(fixture.db, owner, "Worker fixture");
  const community = await createCommunity(fixture.db, owner, tenantId, { name: "Fixture club", slug: "worker-club" });
  const scope = [tenantId, community.id, owner];
  await fixture.admin.query(`
    insert into public.community_applications (tenant_id,community_id,user_id,status,questions_version,rules_version,adult_confirmed_at,decided_at)
    select $1,$2,$3,state,1,1,now(),now()-make_interval(days => age)
    from (values ('declined',100),('withdrawn',95),('declined',1),('pending',100)) as fixture(state,age)`, scope);
  await fixture.admin.query(`
    insert into public.community_notifications (tenant_id,community_id,recipient_id,kind,target_type,target_id,read_at)
    select $1,$2,$3,'application','application',coalesce(age::text,'unread'),now()-make_interval(days => age)
    from (values (100),(95),(1),(null)) as fixture(age)`, scope);
  await fixture.admin.query(`
    insert into public.community_email_deliveries
      (tenant_id,community_id,recipient_id,kind,idempotency_key,created_at)
    select $1,$2,$3,'digest',age::text,now()-make_interval(days => age) from (values (100),(95),(1)) as fixture(age)`, scope);

  await expect(fixture.pool.query("select public.community_purge_applications(1)")).rejects.toMatchObject({ code: "42501" });
  await expect(fixture.workerPool.query("select public.community_purge_notifications(0)")).rejects.toThrow("Invalid purge limit");
  const apps = async () => (await fixture.workerPool.query("select public.community_purge_applications(1) as count")).rows[0].count;
  const notifications = async () => (await fixture.workerPool.query("select public.community_purge_notifications(1) as count")).rows[0].count;
  for (const n of [1, 1, 0]) expect(await apps()).toBe(n);
  for (const n of [2, 2, 0]) expect(await notifications()).toBe(n);
  expect((await fixture.admin.query("select status from public.community_applications order by status")).rows)
    .toEqual([{ status: "declined" }, { status: "pending" }]);
  expect((await fixture.admin.query("select target_id from public.community_notifications order by target_id")).rows)
    .toEqual([{ target_id: "1" }, { target_id: "unread" }]);
});

it("keeps the Node publisher CLI on its existing session advisory lock", async () => {
  const holder = await fixture.workerPool.connect();
  await holder.query("select pg_advisory_lock(hashtext('harvest:social-publisher'))");
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/run-social-publisher.ts"], {
      env: { PATH: process.env.PATH, NODE_ENV: "test", HARVEST_SOCIAL_PUBLISHER: "test", WORKER_DATABASE_URL: fixture.workerURL },
    }).catch(() => { throw new Error("NODE_PUBLISHER_CLI_FAILED"); });
    expect(JSON.parse(stdout)).toEqual({ alreadyRunning: true });
  } finally {
    await holder.query("select pg_advisory_unlock(hashtext('harvest:social-publisher'))");
    holder.release();
  }
});
