import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { users } from "../../src/db/schema";
import { checkRetentionRules, runRetentionRules, runRetentionWorker } from "../../src/server/retention-jobs";
import { mergeContacts } from "../../src/server/crm-merge";
import { createNote } from "../../src/server/crm-tasks";
import { createWorkspace } from "../../src/server/workspaces";
import { testDatabase } from "../database";

let f: Awaited<ReturnType<typeof testDatabase>>;
let tenant: string;
const actor = "retention-test-owner";
const rule = (name: string) => f.workerPool.query("select public.retention_run_rule($1) as result", [name]).then(r => r.rows[0].result);
beforeAll(async () => {
  f = await testDatabase({ migrationOwner: true });
  await f.db.insert(users).values({ id: actor, name: "Synthetic owner", email: "retention-owner@example.invalid" });
  tenant = (await createWorkspace(f.db, actor, "Synthetic ministry")).tenantId;
}, 120_000);
afterAll(async () => { await f?.close(); });

it("does not open a connection or send anything while switched off", async () => {
  const open = vi.fn();
  const output = { log: vi.fn(), error: vi.fn() };
  const send = vi.fn();
  for (const mode of ["run", "check"]) {
    await expect(runRetentionWorker(mode, { NODE_ENV: "production" }, open, output, send)).resolves.toBe(0);
    await expect(runRetentionWorker(mode, { NODE_ENV: "test", RETENTION_JOBS_ENABLED: "0" }, open, output, send)).resolves.toBe(0);
  }
  expect(open).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});

it("runs and records all the existing retention lanes through the restricted worker", async () => {
  await expect(f.pool.query("select public.retention_run_rule('audit_logs')")).rejects.toMatchObject({ code: "42501" });
  await expect(f.workerPool.query("select * from public.retention_rule_runs")).rejects.toMatchObject({ code: "42501" });
  const outcomes = await runRetentionRules(f.workerPool);
  expect(outcomes).toHaveLength(13);
  expect(outcomes.filter(r => r.errorCode)).toEqual([]);
  const { rows } = await f.admin.query("select rule, duration_ms, deleted, anonymised, error_code from public.retention_rule_runs");
  expect(rows).toHaveLength(13);
  expect(rows).toContainEqual({ rule: "connect_tombstones", duration_ms: expect.any(Number), deleted: 0, anonymised: 0, error_code: null });
  expect((await checkRetentionRules(f.workerPool)).healthy).toBe(true);
  const { rows: suppressed } = await f.pool.query("select public.connect_suppress_small(n) as shown from generate_series(1,5) as n");
  expect(suppressed.map(r => r.shown)).toEqual([null, null, null, null, 5]);
});

it("deletes expired audit and run-log rows, leaving younger rows untouched", async () => {
  const old = randomUUID(), fresh = randomUUID();
  for (const table of ["audit_logs", "platform_staff_audit"]) {
    await f.admin.query(`insert into public.${table}(id, actor_id, action, created_at) values
      ($1,$3,'retention.synthetic',now()-interval '13 months'),($2,$3,'retention.synthetic',now()-interval '11 months')`, [old, fresh, actor]);
  }
  await expect(f.admin.query("delete from public.audit_logs where id=$1", [old])).rejects.toThrow("append-only");
  expect(await rule("audit_logs")).toMatchObject({ deleted: 2, errorCode: null });
  for (const table of ["audit_logs", "platform_staff_audit"]) {
    const { rows } = await f.admin.query(`select id from public.${table} where id in ($1,$2)`, [old, fresh]);
    expect(rows).toEqual([{ id: fresh }]);
  }
  await f.admin.query(`insert into public.retention_rule_runs(id,rule,finished_at,duration_ms,deleted,anonymised,flagged)
    values ($1,'audit_logs',now()-interval '91 days',0,0,0,0),($2,'audit_logs',now()-interval '89 days',0,0,0,0)`, [old, fresh]);
  expect(await rule("retention_run_logs")).toMatchObject({ deleted: 1, errorCode: null });
  expect((await f.admin.query("select id from public.retention_rule_runs where id in ($1,$2)", [old, fresh])).rows).toEqual([{ id: fresh }]);
});

it("keeps gift, payment and consent audit rows for 10 years and all others for 12 months", async () => {
  // Founder decision 28 Nov 2026.
  const ages = { m11: "11 months", m13: "13 months", y11: "11 years" } as const;
  const actions = { gift: "giving.gift.confirm", payment: "ministry.payments.connect", consent: "contact.consent_record",
    other: "crm.view_create", nearMiss: "contact.consent_record_extra" } as const;
  const kept10y = new Set(["gift", "payment", "consent"]);
  for (const table of ["audit_logs", "platform_staff_audit"]) {
    const seeded: { id: string; expectKept: boolean }[] = [];
    for (const [kind, action] of Object.entries(actions)) {
      for (const [age, interval] of Object.entries(ages)) {
        const id = randomUUID();
        await f.admin.query(`insert into public.${table}(id, actor_id, action, created_at) values ($1,$2,$3,now()-$4::interval)`, [id, actor, action, interval]);
        seeded.push({ id, expectKept: age === "m11" || (age === "m13" && kept10y.has(kind)) });
      }
    }
    await rule("audit_logs");
    const { rows } = await f.admin.query(`select id from public.${table} where id = any($1)`, [seeded.map(row => row.id)]);
    expect(rows.map(row => row.id).sort()).toEqual(seeded.filter(row => row.expectKept).map(row => row.id).sort());
  }
});

it("flags and clears inactive verified contacts without deleting their records", async () => {
  const inactive = randomUUID(), active = randomUUID(), unverified = randomUUID();
  await f.admin.query(`insert into contacts(tenant_id,id,name,updated_at) values
    ($1,$2,'Synthetic inactive',now()-interval '25 months'),($1,$3,'Synthetic active',now()-interval '25 months'),
    ($1,$4,'Synthetic unverified',now()-interval '25 months')`, [tenant, inactive, active, unverified]);
  await f.admin.query(`insert into retention_contact_reviews(tenant_id,contact_id,verified_at) values
    ($1,$2,now()-interval '25 months'),($1,$3,now()-interval '25 months')`, [tenant, inactive, active]);
  await createNote(f.db, actor, tenant, { body: "Synthetic activity", target: "person", targetId: active });
  expect(await rule("verified_contact_review")).toMatchObject({ deleted: 0, flagged: 1, errorCode: null });
  expect((await f.admin.query("select contact_id from retention_contact_reviews where review_due")).rows).toEqual([{ contact_id: inactive }]);
  await f.admin.query("update contacts set updated_at=now() where (tenant_id,id)=($1,$2)", [tenant, inactive]);
  expect(await rule("verified_contact_review")).toMatchObject({ deleted: 0, flagged: 0, errorCode: null });
  expect((await f.admin.query("select contact_id from retention_contact_reviews where review_due")).rows).toEqual([]);
  expect((await f.admin.query("select id from contacts where tenant_id=$1", [tenant])).rows).toHaveLength(3);
  await mergeContacts(f.db, actor, tenant, unverified, { sourceId: inactive, sourceVersion: 1, targetVersion: 1 });
  const tracked = (await f.admin.query("select contact_id from retention_contact_reviews order by contact_id")).rows.map(row => row.contact_id);
  expect(tracked).toEqual([active, unverified].sort());
});

it("raises one alert per failure or staleness incident and re-arms after success", async () => {
  const send = vi.fn().mockResolvedValue(undefined);
  await runRetentionRules(f.workerPool);
  await f.admin.query("update retention_rule_status set last_run_at=now()-interval '49 hours' where rule='audit_logs'");
  const inject = async () => {
    await f.admin.query(`create function public.retention_test_failure() returns trigger language plpgsql as $$ begin raise exception 'synthetic'; end $$;
      create trigger retention_test_failure before delete on public.audit_logs for each row execute function public.retention_test_failure()`);
    await f.admin.query("insert into audit_logs(actor_id,action,created_at) values ($1,'retention.synthetic',now()-interval '13 months')", [actor]);
  };
  const clear = () => f.admin.query("drop trigger retention_test_failure on audit_logs; drop function retention_test_failure()");
  await checkRetentionRules(f.workerPool, send);
  expect(send).toHaveBeenCalledExactlyOnceWith({ rule: "audit_logs", reason: "stale", errorCode: null });
  await rule("audit_logs");
  for (let incident = 0; incident < 2; incident++) {
    await inject();
    expect(await rule("audit_logs")).toMatchObject({ errorCode: "database_error" });
    await Promise.all([checkRetentionRules(f.workerPool, send), checkRetentionRules(f.workerPool, send)]);
    expect(send).toHaveBeenCalledTimes(incident + 2);
    expect(send).toHaveBeenLastCalledWith({ rule: "audit_logs", reason: "failed", errorCode: "database_error" });
    await clear();
    expect(await rule("audit_logs")).toMatchObject({ errorCode: null });
  }
});
